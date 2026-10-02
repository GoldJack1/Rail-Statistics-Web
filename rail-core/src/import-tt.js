#!/usr/bin/env node
/**
 * Import a Darwin/CIF MCA into day-*.sqlite.
 * Usage: node src/import-tt.js <cif-file> [YYYY-MM-DD] [ahead-days]
 * Only workings that run on each calendar day are written. ahead-days (default
 * TT_CIF_AHEAD_DAYS, else 0) also fills the following dates from the same file.
 */
import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { adoptUidOntoRid, hhmm, openCatalog, openDayDb, refreshServiceJourney, upsertCall, upsertService } from "./db.js";
import { parseCifAa, upsertAssociation } from "./associations.js";
import { addCalendarDays } from "./calendar-day.js";
import { cifBsRunsOn } from "./cif-schedule.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-tt.js <cif-file> [YYYY-MM-DD] [ahead-days]");
  process.exit(1);
}

const startYmd = basename(file).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || process.argv[3];
if (!startYmd) {
  console.error("pass a date YYYY-MM-DD as second arg if the filename has none");
  process.exit(1);
}

const ahead = Math.min(28, Math.max(0, Number(process.argv[4] ?? process.env.TT_CIF_AHEAD_DAYS ?? 0) || 0));
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const catalog = openCatalog(DATA_DIR);
const crsStmt = catalog.prepare(`SELECT crs FROM tiploc WHERE tiploc = ?`);
const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
const crsCache = new Map();
const days = [];
for (let i = 0; i <= ahead; i++) {
  const ymd = addCalendarDays(startYmd, i);
  days.push({
    ymd,
    compact: ymd.replace(/-/g, ""),
    db: openDayDb(DATA_DIR, ymd),
    nSvc: 0,
    nCall: 0,
    uidStmt: null,
  });
}
for (const day of days) {
  day.uidStmt = day.db.prepare(`SELECT rid, service_type FROM services WHERE uid = ? COLLATE NOCASE LIMIT 1`);
}

function openCifLines(path) {
  const fd = openSync(path, "r");
  const magic = Buffer.alloc(2);
  readSync(fd, magic, 0, 2, 0);
  closeSync(fd);
  let input = createReadStream(path);
  if (magic[0] === 0x1f && magic[1] === 0x8b) input = input.pipe(createGunzip());
  return createInterface({ input, crlfDelay: Infinity });
}

let currents = [];

function crsForTpl(tpl) {
  const key = String(tpl).toUpperCase();
  if (crsCache.has(key)) return crsCache.get(key);
  const row = crsStmt.get(key);
  const crs = row?.crs || null;
  crsCache.set(key, crs);
  return crs;
}

function ridForUid(day, uid) {
  const existing = day.uidStmt.get(uid);
  if (existing?.rid) return existing;
  return { rid: `${day.compact}${uid}`, service_type: null };
}

function stationName(crs, tpl) {
  if (crs) {
    const byCrs = nameByCrs.get(crs);
    if (byCrs?.name) return byCrs.name;
  }
  if (tpl) {
    const byTpl = nameByTpl.get(String(tpl).toUpperCase());
    if (byTpl?.name) return byTpl.name;
  }
  return null;
}

function flush() {
  for (const current of currents) {
    if (!current) continue;
    const { day } = current;
    const darwinPassenger = current.hadDarwin && current.darwinType !== "freight";
    if (darwinPassenger) current.svc.service_type = "passenger";
    upsertService(day.db, current.svc, { overlay: Boolean(current.hadDarwin) });
    if (current.svc.uid) adoptUidOntoRid(day.db, current.svc.uid, current.svc.rid);
    day.nSvc++;
    for (const c of current.calls) {
      upsertCall(day.db, c, { cifMerge: true });
      day.nCall++;
    }
    refreshServiceJourney(day.db, current.svc.rid, stationName);
  }
  currents = [];
}

function parseHhmm(s) {
  const t = String(s || "").replace(/\s/g, "");
  if (t.length < 4) return null;
  return hhmm(t.slice(0, 4));
}

function makeCurrent(day, line) {
  const uid = line.slice(3, 9).trim();
  const toc = line.slice(70, 72).trim() || null;
  const trainId = line.slice(32, 36).trim() || null;
  const status = line.slice(2, 3);
  const found = ridForUid(day, uid);
  return {
    day,
    hadDarwin: Boolean(found.rid && found.rid !== `${day.compact}${uid}`),
    darwinType: found.service_type,
    svc: {
      rid: found.rid,
      uid,
      train_id: trainId,
      rs_id: null,
      toc,
      operator_name: toc,
      origin_crs: null,
      origin_name: null,
      destination_crs: null,
      destination_name: null,
      via: null,
      service_type: status === "F" ? "freight" : "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: line.slice(30, 32).trim() || null,
      headcode: trainId,
      updated_at: 1,
    },
    calls: [],
    seq: 0,
  };
}

function pushCall(current, rec, line) {
  const tpl = line.slice(2, 10).trim();
  const isPass = rec === "LI" && line.slice(42, 44).trim() === "T";
  const wtd = parseHhmm(line.slice(15, 19));
  const wta = parseHhmm(line.slice(11, 15));
  const wtp = rec === "LI" ? parseHhmm(line.slice(15, 19)) : null;
  const ptd = parseHhmm(line.slice(37, 41));
  const pta = parseHhmm(line.slice(43, 47));
  const act = line.slice(42, 44).trim();
  const passing = rec === "LI" && (act === "T " || act === "T" || isPass) && !pta && !ptd;
  current.calls.push({
    rid: current.svc.rid,
    tiploc: tpl,
    crs: crsForTpl(tpl),
      seq: current.seq++,
    is_passing: passing ? 1 : 0,
    cancelled: 0,
    platform: null,
    length_cars: null,
    formation: null,
    sta: pta,
    std: ptd,
    wta,
    wtd,
    wtp: passing ? wtp || wtd : null,
    ata: null,
    atd: null,
    atp: null,
    eta: null,
    etd: null,
    etp: null,
    delay_minutes: null,
    status: null,
    live_kind: "scheduled",
    actual_source: null,
    updated_at: 1,
  });
  if (rec === "LO" && !current.svc.origin_crs) current.svc.origin_name = tpl;
  if (rec === "LT") current.svc.destination_name = tpl;
}

for (const day of days) day.db.exec("BEGIN");
try {
  for await (const line of openCifLines(file)) {
    const rec = line.slice(0, 2);
    if (rec === "AA") {
      for (const day of days) {
        const assoc = parseCifAa(line, day.ymd, (uid) => ridForUid(day, uid).rid);
        if (assoc) upsertAssociation(day.db, assoc);
      }
      continue;
    }
    if (rec === "BS") {
      flush();
      currents = days.filter((day) => cifBsRunsOn(line, day.ymd)).map((day) => makeCurrent(day, line));
      continue;
    }
    if (!currents.length) continue;
    if (rec === "LO" || rec === "LI" || rec === "LT") {
      for (const current of currents) pushCall(current, rec, line);
    }
  }
  flush();
  for (const day of days) {
    day.db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('timetable_imported', ?)`).run(day.ymd);
    day.db.exec("COMMIT");
    console.log(`imported ${day.nSvc} services, ${day.nCall} calls into day-${day.ymd}.sqlite`);
    day.db.close();
  }
} catch (err) {
  for (const day of days) {
    try {
      day.db.exec("ROLLBACK");
    } catch {
      /* not in a transaction */
    }
    try {
      day.db.close();
    } catch {
      /* */
    }
  }
  throw err;
}
catalog.close();
