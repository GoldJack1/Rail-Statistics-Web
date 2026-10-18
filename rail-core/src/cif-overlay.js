/**
 * Shared Darwin ← CIF/ITPS/VSTP working-timetable overlay.
 */
import { createReadStream, existsSync, openSync, readSync, closeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import {
  openCatalog,
  openDayDb,
  refreshServiceJourney,
  restoreCallLive,
  snapshotCallLive,
  upsertCall,
  upsertService,
} from "./db.js";
import {
  cifBsRunsOn,
  cifMatchesDarwinPublicPath,
  cifStpRank,
  cifWeekdayIndex,
  darwinScheduleAnchors,
  mergeDarwinCallsWithCifPasses,
  parseCifBsProfile,
  parseCifBsStock,
  parseCifBxAtoc,
  parseCifChange,
  parseCifLocation,
} from "./cif-schedule.js";
import { scheduleDocument } from "./schedule-notes.js";

export function openCifLines(path) {
  const fd = openSync(path, "r");
  const magic = Buffer.alloc(2);
  readSync(fd, magic, 0, 2, 0);
  closeSync(fd);
  let input = createReadStream(path);
  if (magic[0] === 0x1f && magic[1] === 0x8b) input = input.pipe(createGunzip());
  return createInterface({ input, crlfDelay: Infinity });
}

function rememberWorking(workings, working, preferLongest = false) {
  if (!working?.uid || !working.locs?.length) return;
  const prev = workings.get(working.uid);
  if (!prev) {
    workings.set(working.uid, working);
    return;
  }
  if (preferLongest) {
    const longer = (working.locs.length || 0) > (prev.locs.length || 0);
    const same = working.locs.length === prev.locs.length && working.rank >= prev.rank;
    if (longer || same) workings.set(working.uid, working);
    return;
  }
  if (working.rank >= prev.rank) workings.set(working.uid, working);
}

function bsWorking(line) {
  const stock = parseCifBsStock(line);
  const profile = parseCifBsProfile(line);
  return {
    uid: line.slice(3, 9).trim().toUpperCase(),
    rank: cifStpRank(line),
    locs: [],
    changes: [],
    source: "cif",
    powerType: stock.powerType,
    timingLoad: stock.timingLoad,
    trainStatus: profile?.trainStatus || null,
    category: profile?.category || null,
    headcode: profile?.identity || null,
    schedule: profile,
    runsOnYmd: false,
    toc: null,
  };
}

export function isCifOnlyBoardWorking(working) {
  if (String(working?.trainStatus || "").toUpperCase() === "F") return true;
  const d = String(working?.headcode || "").charAt(0);
  return ["0", "3", "4", "5", "6", "7", "8"].includes(d);
}

function locsAsDarwin(locs) {
  return (locs || []).map((loc) => ({
    tiploc: loc.tiploc,
    sta: loc.pta,
    std: loc.ptd,
    is_passing: loc.passing ? 1 : 0,
  }));
}

function pickWorkingLocs(today, longest) {
  if (!today) return longest || null;
  if (!longest || (longest.locs?.length || 0) <= (today.locs?.length || 0)) return today;
  if (cifMatchesDarwinPublicPath(locsAsDarwin(today.locs), longest.locs)) {
    return { ...today, locs: longest.locs, powerType: today.powerType || longest.powerType, timingLoad: today.timingLoad || longest.timingLoad };
  }
  return {
    ...today,
    longestLocs: longest.locs,
    powerType: today.powerType || longest.powerType,
    timingLoad: today.timingLoad || longest.timingLoad,
  };
}

export async function loadCifWorkings(file, ymd, { preferLongest = false, ignoreYmd = false } = {}) {
  const today = new Map();
  const longest = new Map();
  let current = null;
  const flush = () => {
    if (!current) return;
    if (current.runsOnYmd) rememberWorking(today, current, false);
    if (preferLongest || ignoreYmd) rememberWorking(longest, current, true);
    else rememberWorking(today, current, false);
  };
  for await (const line of openCifLines(file)) {
    const rec = line.slice(0, 2);
    if (rec === "BS") {
      flush();
      current = null;
      const txn = line.slice(2, 3).toUpperCase();
      const stp = (line[79] || "").toUpperCase();
      if (txn === "D" || stp === "C") continue;
      const runs = cifBsRunsOn(line, ymd);
      if (!ignoreYmd && !runs) continue;
      current = { ...bsWorking(line), runsOnYmd: runs };
      continue;
    }
    if (!current) continue;
    if (rec === "BX") {
      current.toc = parseCifBxAtoc(line) || current.toc;
      continue;
    }
    if (rec === "CR") {
      const change = parseCifChange(line);
      if (change) current.changes.push(change);
      continue;
    }
    if (rec === "LO" || rec === "LI" || rec === "LT") {
      const loc = parseCifLocation(rec, line);
      if (loc.tiploc) current.locs.push(loc);
    }
  }
  flush();
  if (!preferLongest && !ignoreYmd) return today;
  const out = new Map(today);
  for (const [uid, longW] of longest) {
    out.set(uid, pickWorkingLocs(today.get(uid), longW) || longW);
  }
  return out;
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

export function siblingCifPath(jsonFile) {
  const dir = dirname(jsonFile);
  const stem = basename(jsonFile).replace(/\.json(\.gz)?$/i, "");
  for (const name of [`${stem}.CIF.gz`, `${stem}.CIF`, "toc-full.CIF.gz", "toc-full.CIF"]) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Prefer the longer CIF WTT spine; keep JSON power type / timing load when present. */
export function mergeJsonAndCifWorkings(jsonMap, cifMap) {
  const out = new Map(jsonMap);
  for (const [uid, cif] of cifMap) {
    const j = out.get(uid);
    const cifLen = cif?.locs?.length || 0;
    const jsonLen = j?.locs?.length || 0;
    if (!j || cifLen > jsonLen) {
      out.set(uid, {
        ...cif,
        powerType: j?.powerType || cif.powerType || null,
        timingLoad: j?.timingLoad || cif.timingLoad || null,
        rank: Math.max(j?.rank || 0, cif.rank || 0),
        runsOnYmd: Boolean(j || cif.runsOnYmd),
      });
    }
  }
  return out;
}

export async function loadScheduleWorkings(file, ymd) {
  if (/\.json$/i.test(file)) {
    const json = await loadJsonWorkings(file, ymd);
    const cifFile = siblingCifPath(file);
    if (!cifFile) return json;
    const cif = await loadCifWorkings(cifFile, ymd, { preferLongest: true, ignoreYmd: true });
    return mergeJsonAndCifWorkings(json, cif);
  }
  return loadCifWorkings(file, ymd, { preferLongest: true, ignoreYmd: true });
}

function hhmmFromSchedule(raw) {
  const m = String(raw || "")
    .toUpperCase()
    .match(/(\d{4})(H)?/);
  if (!m) return null;
  const hm = `${m[1].slice(0, 2)}:${m[1].slice(2, 4)}`;
  return m[2] === "H" ? `${hm}½` : hm;
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
    line: loc.line ? String(loc.line).trim().toUpperCase() : null,
    path: loc.path ? String(loc.path).trim().toUpperCase() : null,
    engineeringAllowance: loc.engineering_allowance || null,
    pathingAllowance: loc.pathing_allowance || null,
    performanceAllowance: loc.performance_allowance || null,
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
  const seg = list[0] || {};
  return {
    uid,
    rank,
    locs,
    source,
    headcode: seg.signalling_id || schedule.signalling_id || null,
    powerType: String(seg.CIF_power_type || schedule.CIF_power_type || "").trim().toUpperCase() || null,
    timingLoad: String(seg.CIF_timing_load || schedule.CIF_timing_load || "").trim().toUpperCase() || null,
    schedule: {
      runsFrom: schedule.schedule_start_date || null,
      runsTo: schedule.schedule_end_date || null,
      daysRun: schedule.schedule_days_runs || null,
      category: schedule.CIF_train_category || null,
      identity: seg.signalling_id || schedule.signalling_id || null,
      headcode: schedule.CIF_headcode || null,
      tsc: schedule.CIF_train_service_code || null,
      speed: schedule.CIF_speed ? String(Number(schedule.CIF_speed) || schedule.CIF_speed) : null,
      seating: schedule.CIF_train_class || null,
      reservations: schedule.CIF_reservations || null,
      operating: schedule.CIF_operating_characteristics || null,
    },
    changes: [],
  };
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
    const withCrs = (locs) =>
      (locs || []).map((loc) => ({
        ...loc,
        crs: loc.crs || resolveCrs(loc.tiploc),
      }));
    const locs = withCrs(working.locs);
    const darwinCalls = locStmt.all(svc.rid);
    // Overlay from passenger/live anchors so prior graph-fill detours are not kept.
    let merged = mergeDarwinCallsWithCifPasses(darwinScheduleAnchors(darwinCalls), locs);
    if (working.longestLocs?.length) {
      merged = mergeDarwinCallsWithCifPasses(merged, withCrs(working.longestLocs));
    }
    const extra = merged.filter((c) => c.cifPass);
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
              path: row.path ?? null,
              line: row.line ?? null,
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
      if (working.powerType || working.timingLoad || working.schedule) {
        const scheduleJson = working.schedule || working.changes?.length ? JSON.stringify(scheduleDocument(working)) : null;
        db.prepare(
          `UPDATE services SET power_type=COALESCE(power_type, ?), timing_load=COALESCE(timing_load, ?), schedule_json=COALESCE(?, schedule_json) WHERE rid=?`,
        ).run(working.powerType || null, working.timingLoad || null, scheduleJson, svc.rid);
      }
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

  const existingUids = new Set(darwinSvcs.map((s) => String(s.uid).toUpperCase()));
  const compact = String(ymd || "").replace(/-/g, "");
  let cifOnly = 0;
  if (/^\d{8}$/.test(compact)) {
    const hasRid = db.prepare(`SELECT rid FROM services WHERE rid = ? OR uid = ? COLLATE NOCASE LIMIT 1`);
    for (const [uid, working] of workings) {
      if (existingUids.has(uid) || !working?.runsOnYmd || !isCifOnlyBoardWorking(working) || !working.locs?.length) {
        continue;
      }
      const rid = `${compact}${uid}`;
      if (hasRid.get(rid, uid)?.rid) continue;
      const head = String(working.headcode || "").charAt(0);
      const freight = working.trainStatus === "F" || ["4", "6", "7", "8"].includes(head);
      db.exec("BEGIN IMMEDIATE");
      try {
        upsertService(db, {
          rid,
          uid,
          train_id: working.headcode || null,
          rs_id: null,
          toc: working.toc || null,
          operator_name: working.toc || null,
          origin_crs: null,
          origin_name: null,
          destination_crs: null,
          destination_name: null,
          via: null,
          service_type: freight ? "freight" : "passenger",
          cancelled: 0,
          cancel_reason: null,
          delay_reason: null,
          is_charter: 0,
          category: working.category || null,
          headcode: working.headcode || null,
          formation: null,
          power_type: working.powerType || null,
          timing_load: working.timingLoad || null,
          updated_at: Date.now(),
        });
        working.locs.forEach((loc, seq) => {
          const passing = Boolean(loc.passing) || Boolean(loc.wtp && !loc.wta && !loc.wtd && !loc.pta && !loc.ptd);
          upsertCall(db, {
            rid,
            tiploc: loc.tiploc,
            crs: loc.crs || resolveCrs(loc.tiploc),
            seq,
            is_passing: passing ? 1 : 0,
            cancelled: 0,
            platform: loc.platform ?? null,
            length_cars: null,
            formation: null,
            sta: loc.pta ?? null,
            std: loc.ptd ?? null,
            wta: loc.wta ?? null,
            wtd: loc.wtd ?? null,
            wtp: passing ? loc.wtp || loc.wtd || null : loc.wtp ?? null,
            path: loc.path ?? null,
            line: loc.line ?? null,
            ata: null,
            atd: null,
            atp: null,
            eta: null,
            etd: null,
            etp: null,
            delay_minutes: null,
            status: null,
            live_kind: "scheduled",
            actual_source: "cif",
            updated_at: Date.now(),
          });
        });
        refreshServiceJourney(db, rid, resolveName);
        if (working.schedule) {
          db.prepare(`UPDATE services SET schedule_json = ? WHERE rid = ?`).run(JSON.stringify(scheduleDocument(working)), rid);
        }
        db.exec("COMMIT");
        cifOnly++;
        inserted += working.locs.length;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
    }
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
  return { services, inserted, cifOnly, workings: workings.size };
}

export function overlayOneWorking(dataDir, ymd, working) {
  if (!working?.uid || !working.locs?.length) return { services: 0, inserted: 0 };
  const map = new Map([[String(working.uid).toUpperCase(), working]]);
  return applyWorkingsOverlay(dataDir, ymd, map);
}
