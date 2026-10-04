/**
 * Shared Darwin ← CIF/ITPS/VSTP working-timetable overlay.
 */
import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import {
  openCatalog,
  openDayDb,
  refreshServiceJourney,
  restoreCallLive,
  snapshotCallLive,
  upsertCall,
} from "./db.js";
import {
  cifBsRunsOn,
  cifStpRank,
  cifWeekdayIndex,
  darwinScheduleAnchors,
  mergeDarwinCallsWithCifPasses,
  parseCifLocation,
} from "./cif-schedule.js";

export function openCifLines(path) {
  const fd = openSync(path, "r");
  const magic = Buffer.alloc(2);
  readSync(fd, magic, 0, 2, 0);
  closeSync(fd);
  let input = createReadStream(path);
  if (magic[0] === 0x1f && magic[1] === 0x8b) input = input.pipe(createGunzip());
  return createInterface({ input, crlfDelay: Infinity });
}

function rememberWorking(workings, working) {
  if (!working?.uid || !working.locs?.length) return;
  const prev = workings.get(working.uid);
  if (!prev || working.rank >= prev.rank) workings.set(working.uid, working);
}

export async function loadCifWorkings(file, ymd) {
  const workings = new Map();
  let current = null;
  const flush = () => rememberWorking(workings, current);
  for await (const line of openCifLines(file)) {
    const rec = line.slice(0, 2);
    if (rec === "BS") {
      flush();
      current = null;
      if (!cifBsRunsOn(line, ymd)) continue;
      current = {
        uid: line.slice(3, 9).trim().toUpperCase(),
        rank: cifStpRank(line),
        locs: [],
        source: "cif",
      };
      continue;
    }
    if (!current) continue;
    if (rec === "LO" || rec === "LI" || rec === "LT") {
      const loc = parseCifLocation(rec, line);
      if (loc.tiploc) current.locs.push(loc);
    }
  }
  flush();
  return workings;
}

function jsonStpRank(stp) {
  const s = String(stp || "").toUpperCase();
  if (s === "O") return 3;
  if (s === "N") return 2;
  if (s === "P") return 1;
  return 0;
}

/** SCHEDULE JSON runs-on check (dates + days_runs). */
export function jsonScheduleRunsOn(schedule, ymd) {
  if (!schedule || !/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return false;
  const stp = String(schedule.CIF_stp_indicator || schedule.stp_indicator || "").toUpperCase();
  if (stp === "C") return false;
  const start = schedule.schedule_start_date || schedule.CIF_start_date || null;
  const end = schedule.schedule_end_date || schedule.CIF_end_date || null;
  if (start && ymd < start) return false;
  if (end && ymd > end) return false;
  const days = String(schedule.schedule_days_runs || schedule.CIF_days_runs || "");
  if (days.length >= 7 && days[cifWeekdayIndex(ymd)] === "0") return false;
  return true;
}

export async function loadJsonWorkings(file, ymd) {
  const workings = new Map();
  const input = createReadStream(file);
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s || s[0] !== "{") continue;
    let obj;
    try {
      obj = JSON.parse(s);
    } catch {
      continue;
    }
    const schedule = obj.JsonScheduleV1 || obj.schedule || obj.VSTPCIFMsgV1?.schedule;
    if (!schedule || !jsonScheduleRunsOn(schedule, ymd)) continue;
    const working = workingFromScheduleJson(schedule, {
      rank: jsonStpRank(schedule.CIF_stp_indicator || schedule.stp_indicator),
      source: "itps-json",
    });
    rememberWorking(workings, working);
  }
  return workings;
}

export async function loadScheduleWorkings(file, ymd) {
  if (/\.json$/i.test(file)) return loadJsonWorkings(file, ymd);
  return loadCifWorkings(file, ymd);
}

function hhmmFromSchedule(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 4) return null;
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

/** Convert one SCHEDULE/VSTP JSON location into the shape mergeDarwinCallsWithCifPasses expects. */
export function scheduleJsonLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const tiploc = String(loc.tiploc_code || loc.tiploc || loc.TIPLOC || "")
    .trim()
    .toUpperCase();
  if (!tiploc) return null;
  const pass = hhmmFromSchedule(loc.pass);
  const wta = hhmmFromSchedule(loc.arrival);
  const wtd = hhmmFromSchedule(loc.departure);
  const pta = hhmmFromSchedule(loc.public_arrival);
  const ptd = hhmmFromSchedule(loc.public_departure);
  const passing = Boolean(pass && !pta && !ptd);
  return {
    tiploc,
    wta,
    wtd,
    wtp: pass || (passing ? wtd : null),
    pta,
    ptd,
    platform: loc.platform ? String(loc.platform).trim() : null,
    passing,
  };
}

export function workingFromScheduleJson(schedule, { rank = 3, source = "vstp" } = {}) {
  if (!schedule || typeof schedule !== "object") return null;
  const uid = String(schedule.CIF_train_uid || schedule.train_uid || schedule.uid || "")
    .trim()
    .toUpperCase();
  if (!uid) return null;
  const segments = schedule.schedule_segment || schedule.schedule_segments || [];
  const list = Array.isArray(segments) ? segments : [segments];
  const locs = [];
  for (const seg of list) {
    const rawLocs = seg?.schedule_location || seg?.locations || [];
    for (const loc of Array.isArray(rawLocs) ? rawLocs : [rawLocs]) {
      const parsed = scheduleJsonLocation(loc);
      if (parsed) locs.push(parsed);
    }
  }
  if (!locs.length) return null;
  return { uid, rank, locs, source, headcode: list[0]?.signalling_id || schedule.signalling_id || null };
}

export function applyWorkingsOverlay(dataDir, ymd, workings, { crsForTpl, stationName } = {}) {
  const catalog = openCatalog(dataDir);
  const crsStmt = catalog.prepare(`SELECT crs FROM tiploc WHERE tiploc = ?`);
  const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
  const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
  const resolveCrs =
    crsForTpl ||
    ((tpl) => {
      const row = crsStmt.get(String(tpl).toUpperCase());
      return row?.crs || null;
    });
  const resolveName =
    stationName ||
    ((crs, tpl) => {
      if (crs) {
        const byCrs = nameByCrs.get(crs);
        if (byCrs?.name) return byCrs.name;
      }
      if (tpl) {
        const byTpl = nameByTpl.get(String(tpl).toUpperCase());
        if (byTpl?.name) return byTpl.name;
      }
      return null;
    });

  const db = openDayDb(dataDir, ymd);
  db.exec("PRAGMA busy_timeout=300000");
  const darwinSvcs = db
    .prepare(
      `SELECT rid, uid FROM services
       WHERE uid IS NOT NULL AND uid != ''
         AND length(rid)=15 AND rid GLOB '[0-9]*'`,
    )
    .all();
  const locStmt = db.prepare(`SELECT * FROM calls WHERE rid = ? ORDER BY seq`);
  const delCalls = db.prepare(`DELETE FROM calls WHERE rid = ?`);

  let services = 0;
  let inserted = 0;
  // Per-service transactions so overlay can coexist with stomp/ingest writers.
  for (const svc of darwinSvcs) {
    const working = workings.get(String(svc.uid).toUpperCase());
    if (!working?.locs.length) continue;
    const locs = working.locs.map((loc) => ({
      ...loc,
      crs: loc.crs || resolveCrs(loc.tiploc),
    }));
    const darwinCalls = locStmt.all(svc.rid);
    // Overlay from passenger/live anchors so prior graph-fill detours are not kept.
    const merged = mergeDarwinCallsWithCifPasses(darwinScheduleAnchors(darwinCalls), locs);
    const extra = merged.filter((c) => c.cifPass);
    const sameLen = merged.length === darwinCalls.length;
    const sameTpl =
      sameLen && merged.every((c, i) => String(c.tiploc).toUpperCase() === String(darwinCalls[i].tiploc).toUpperCase());
    if (!extra.length && sameTpl) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      const live = snapshotCallLive(db, svc.rid);
      delCalls.run(svc.rid);
      for (const row of merged) {
        const payload = row.cifPass
          ? {
              rid: svc.rid,
              tiploc: row.tiploc,
              crs: row.crs || resolveCrs(row.tiploc),
              seq: row.seq,
              is_passing: row.is_passing,
              cancelled: 0,
              platform: row.platform,
              length_cars: null,
              formation: null,
              sta: row.sta,
              std: row.std,
              wta: row.wta,
              wtd: row.wtd,
              wtp: row.wtp,
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
              updated_at: Date.now(),
            }
          : { ...row, rid: svc.rid, seq: row.seq };
        delete payload.cifPass;
        upsertCall(db, payload);
      }
      if (live.length) restoreCallLive(db, svc.rid, live);
      refreshServiceJourney(db, svc.rid, resolveName);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
    services++;
    inserted += extra.length;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('itps_overlay_at', ?)`).run(
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
  db.close();
  catalog.close();
  return { services, inserted, workings: workings.size };
}

export function overlayOneWorking(dataDir, ymd, working) {
  if (!working?.uid || !working.locs?.length) return { services: 0, inserted: 0 };
  const map = new Map([[String(working.uid).toUpperCase(), working]]);
  return applyWorkingsOverlay(dataDir, ymd, map);
}
