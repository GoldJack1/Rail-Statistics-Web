/**
 * Insert tipocs that lie on the spatial corridor between consecutive spine calls.
 * Safer than global tipoc-graph fill (rejects Dryclough / Poppleton detours).
 *
 * Legacy (TT_GEOM_DENSIFY=1). Prefer ORM path stitch (orm-path.js).
 * Nationwide invariant when enabled: ITPS-validated mid + geometry (≤750 m) only.
 * Tight non-CRS invent and free CRS densify are removed.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  openCatalog,
  openDayDb,
  operatingDayYmd,
  refreshServiceJourney,
  restoreCallLive,
  snapshotCallLive,
  upsertCall,
} from "./db.js";
import { openCifLines, scheduleJsonLocation } from "./cif-overlay.js";
import { interpolateHm, callClock } from "./tiploc-graph.js";

export const DEFAULT_MAX_OFFSET_M = 750;
/** On-chord non-CRS junctions without schedule validation. */
export const DEFAULT_MAX_OFFSET_TIGHT_M = 200;
/** @deprecated Free CRS-only densify removed; kept for callers that still pass the option. */
export const DEFAULT_MAX_OFFSET_CRS_ONLY_M = 500;
export const DEFAULT_SLACK_M = 250;
export const DEFAULT_MIN_PROGRESS_M = 80;
/** Progress floor for validated / near-endpoint inserts (Mirfield, Sowerby). */
export const DEFAULT_MIN_PROGRESS_NEAR_M = 20;
/** Progress floor for tight non-CRS tier. */
export const DEFAULT_MIN_PROGRESS_TIGHT_M = 25;
export const DEFAULT_MIN_SPACING_M = 120;
export const DEFAULT_MAX_PER_GAP = 12;
export const DEFAULT_VALIDATED_MID_MAX_SPAN = 8;
export const DEFAULT_DENSIFY_PASSES = 2;

const NON_PASSENGER_NAME =
  /\b(metrolink|mtlk|t\.?\s*m\.?\s*d|t&r|depot|siemens|n\.?\s*y\.?|yard|down loop|up loop|loop\s*\(|h\.?\s*s\.?\b|trans systems|international dep|marshall|fuelling|fuel(?:ling)?\s*point|turnback|tarmac|sidings?|sdgs?|signal\b|cess|headshunt|carriage\s*sid)/i;

const EARTH_M = 6371000;

export function haversineM(a, b) {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dL = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** Distance from P to segment AB (metres) and along-fraction t in [0,1]. */
export function distToSegmentM(p, a, b) {
  const lat0 = (((a.lat + b.lat + p.lat) / 3) * Math.PI) / 180;
  const toXY = (q) => ({
    x: (q.lon - a.lon) * Math.cos(lat0) * 111320,
    y: (q.lat - a.lat) * 110540,
  });
  const A = { x: 0, y: 0 };
  const B = toXY(b);
  const P = toXY(p);
  const vx = B.x - A.x;
  const vy = B.y - A.y;
  const wx = P.x - A.x;
  const wy = P.y - A.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return { offsetM: Math.hypot(P.x, P.y), t: 0 };
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return { offsetM: Math.hypot(P.x - B.x, P.y - B.y), t: 1 };
  const t = c1 / c2;
  return { offsetM: Math.hypot(P.x - t * vx, P.y - t * vy), t };
}

export function buildGeoIndex(rows) {
  /** @type {Map<string, { tiploc: string, lat: number, lon: number }>} */
  const byTpl = new Map();
  /** @type {Map<string, string[]>} */
  const grid = new Map();
  for (const row of rows) {
    const tiploc = String(row.tiploc || "").toUpperCase();
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!tiploc || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pt = { tiploc, lat, lon };
    byTpl.set(tiploc, pt);
    const key = `${Math.floor(lat * 50)}:${Math.floor(lon * 50)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(tiploc);
  }
  return { byTpl, grid };
}

export function candidatesNearSegment(index, a, b, padDeg = 0.02) {
  const minLat = Math.min(a.lat, b.lat) - padDeg;
  const maxLat = Math.max(a.lat, b.lat) + padDeg;
  const minLon = Math.min(a.lon, b.lon) - padDeg;
  const maxLon = Math.max(a.lon, b.lon) + padDeg;
  const i0 = Math.floor(minLat * 50);
  const i1 = Math.floor(maxLat * 50);
  const j0 = Math.floor(minLon * 50);
  const j1 = Math.floor(maxLon * 50);
  const out = [];
  const seen = new Set();
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const tpl of index.grid.get(`${i}:${j}`) || []) {
        if (seen.has(tpl)) continue;
        seen.add(tpl);
        const pt = index.byTpl.get(tpl);
        if (pt) out.push(pt);
      }
    }
  }
  return out;
}

export function isSignalOrElocTiploc(tiploc) {
  const t = String(tiploc || "").toUpperCase();
  if (!t) return true;
  if (t.startsWith("ELOC")) return true;
  // Signal/berth-like codes: trailing digits (MLNR8, CSTL30) or 3+ embedded digits.
  if (/\d+$/.test(t) || /\d{3,}/.test(t)) return true;
  return false;
}

/** Depots, yards, Metrolink, engineering CRS (X**), marshalling, signals, etc. */
export function isNonPassengerLocation(tiploc, { name = "", crs = "" } = {}) {
  const t = String(tiploc || "").toUpperCase();
  if (isSignalOrElocTiploc(t)) return true;
  const c = String(crs || "").trim().toUpperCase();
  if (c.length === 3 && c.startsWith("X")) return true;
  if (NON_PASSENGER_NAME.test(String(name || ""))) return true;
  if (/\bmtlk\b/i.test(t) || /MTL/i.test(t)) return true;
  if (/(MSL|SDG|TMD|CSD|SIG)$/i.test(t)) return true;
  return false;
}

/**
 * Mine A→…→B intermediate tipocs from an ITPS/CIF schedule file.
 * Returns Map<"FROM\tTO", Set<midTiploc>> for spans of 2..maxSpan hops.
 */
export async function mineValidatedMidsFromScheduleFile(
  file,
  { maxSpan = DEFAULT_VALIDATED_MID_MAX_SPAN } = {},
) {
  const mids = new Map();
  const addPath = (tips) => {
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 2; j <= Math.min(tips.length - 1, i + maxSpan); j++) {
        const key = `${tips[i]}\t${tips[j]}`;
        if (!mids.has(key)) mids.set(key, new Set());
        const set = mids.get(key);
        for (let k = i + 1; k < j; k++) set.add(tips[k]);
      }
    }
  };

  if (/\.json$/i.test(file)) {
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const s = line.trim();
      if (!s || s[0] !== "{") continue;
      let obj;
      try {
        obj = JSON.parse(s);
      } catch {
        continue;
      }
      const schedule = obj.JsonScheduleV1 || obj.schedule;
      if (!schedule) continue;
      const segments = schedule.schedule_segment || [];
      const list = Array.isArray(segments) ? segments : [segments];
      for (const seg of list) {
        const raw = seg?.schedule_location || [];
        const tips = [];
        for (const loc of Array.isArray(raw) ? raw : [raw]) {
          const parsed = scheduleJsonLocation(loc);
          if (parsed?.tiploc) tips.push(parsed.tiploc);
        }
        if (tips.length > 2) addPath(tips);
      }
    }
  } else {
    let locs = [];
    for await (const line of openCifLines(file)) {
      const rec = line.slice(0, 2);
      if (rec === "BS") {
        if (locs.length > 2) addPath(locs);
        locs = [];
        continue;
      }
      if (rec === "LO" || rec === "LI" || rec === "LT") {
        const tpl = String(line.slice(2, 10)).trim().toUpperCase();
        if (tpl) locs.push(tpl);
      }
    }
    if (locs.length > 2) addPath(locs);
  }
  return mids;
}

export function loadStationCrsSet(dataDir) {
  const catalog = openCatalog(dataDir);
  const rows = catalog
    .prepare(
      `SELECT tiploc FROM tiploc
       WHERE crs IS NOT NULL AND TRIM(crs) != '' AND UPPER(SUBSTR(TRIM(crs),1,1)) != 'X'
       UNION
       SELECT tiploc FROM corpus
       WHERE crs IS NOT NULL AND TRIM(crs) != '' AND UPPER(SUBSTR(TRIM(crs),1,1)) != 'X'`,
    )
    .all();
  catalog.close();
  return new Set(rows.map((r) => String(r.tiploc).toUpperCase()));
}

/** Map tipoc → { name, crs } for passenger filters. */
export function loadTiplocMeta(dataDir) {
  const catalog = openCatalog(dataDir);
  const rows = catalog
    .prepare(
      `SELECT tiploc, crs, name FROM tiploc
       UNION
       SELECT tiploc, crs, name FROM corpus`,
    )
    .all();
  catalog.close();
  const meta = new Map();
  for (const row of rows) {
    const t = String(row.tiploc || "").toUpperCase();
    if (!t || meta.has(t)) continue;
    meta.set(t, { crs: row.crs || "", name: row.name || "" });
  }
  return meta;
}

/**
 * Tipocs between A and B on the corridor, ordered along AB.
 * Legacy densify: ITPS-validated + geometry only — never free CRS or tight invent.
 */
export function corridorMids(index, fromTpl, toTpl, opts = {}) {
  const maxOffsetM = opts.maxOffsetM ?? DEFAULT_MAX_OFFSET_M;
  const slackM = opts.slackM ?? DEFAULT_SLACK_M;
  const minProgressNearM = opts.minProgressNearM ?? DEFAULT_MIN_PROGRESS_NEAR_M;
  const minSpacingM = opts.minSpacingM ?? DEFAULT_MIN_SPACING_M;
  const maxPerGap = opts.maxPerGap ?? DEFAULT_MAX_PER_GAP;
  const exclude = opts.exclude || new Set();
  const validatedMids = opts.validatedMids || null;
  const tipocMeta = opts.tipocMeta || null;

  const a = index.byTpl.get(String(fromTpl || "").toUpperCase());
  const b = index.byTpl.get(String(toTpl || "").toUpperCase());
  if (!a || !b) return [];
  const ab = haversineM(a, b);
  if (ab < minProgressNearM * 2) return [];

  const pairKey = `${a.tiploc}\t${b.tiploc}`;
  const validated = validatedMids?.get(pairKey) || null;
  if (!validated?.size) return [];

  const hits = [];
  for (const pt of candidatesNearSegment(index, a, b)) {
    if (pt.tiploc === a.tiploc || pt.tiploc === b.tiploc) continue;
    if (exclude.has(pt.tiploc)) continue;
    const meta = tipocMeta?.get(pt.tiploc) || {};
    if (isNonPassengerLocation(pt.tiploc, meta)) continue;
    const inValidated = Boolean(validated?.has(pt.tiploc));
    if (!inValidated) continue;

    const { offsetM, t } = distToSegmentM(pt, a, b);
    const offsetCap = maxOffsetM;
    const minProg = minProgressNearM;
    if (offsetM > offsetCap) continue;
    // Allow t at endpoints when progress still clears minProg (Mirfield @ 24 m).
    if (t < 0 || t > 1) continue;
    const at = haversineM(a, pt);
    const tb = haversineM(pt, b);
    if (at < minProg || tb < minProg) continue;
    if (at + tb > ab + slackM) continue;
    hits.push({ tiploc: pt.tiploc, t, at, offsetM });
  }
  hits.sort((x, y) => x.t - y.t || x.offsetM - y.offsetM);

  const picked = [];
  // Start negative so the first mid is gated only by minProg (near-endpoint CRS/junctions
  // can sit ~20–60 m after the spine tipoc; minSpacing applies between successive mids).
  let lastAt = -minSpacingM;
  for (const h of hits) {
    if (h.at - lastAt < minSpacingM) continue;
    picked.push(h.tiploc);
    lastAt = h.at;
    if (picked.length >= maxPerGap) break;
  }
  return picked;
}

function densifyCallsOnePass(spine, index, opts, exclude) {
  const out = [];
  let inserted = 0;

  for (let i = 0; i < spine.length; i++) {
    out.push(spine[i]);
    if (i === spine.length - 1) break;
    const a = String(spine[i].tiploc).toUpperCase();
    const b = String(spine[i + 1].tiploc).toUpperCase();
    const mids = corridorMids(index, a, b, { ...opts, exclude });
    if (!mids.length) continue;
    const t0 = callClock(spine[i]);
    const t1 = callClock(spine[i + 1]);
    for (let j = 0; j < mids.length; j++) {
      const tpl = mids[j];
      exclude.add(tpl);
      out.push({
        tiploc: tpl,
        crs: null,
        is_passing: 1,
        cancelled: 0,
        platform: null,
        sta: null,
        std: null,
        wta: null,
        wtd: null,
        wtp: interpolateHm(t0, t1, j, mids.length),
        live_kind: "scheduled",
        actual_source: null,
        geomPass: true,
      });
      inserted++;
    }
  }
  return { calls: out.map((c, seq) => ({ ...c, seq })), inserted };
}

export function densifyCallsWithGeometry(calls, index, opts = {}) {
  const spine = (calls || []).filter((c) => c?.tiploc);
  if (spine.length < 2 || !index?.byTpl?.size) {
    return { calls: spine.map((c, seq) => ({ ...c, seq })), inserted: 0 };
  }

  const passes = Math.max(1, Number(opts.passes ?? DEFAULT_DENSIFY_PASSES) || 1);
  const exclude = new Set(spine.map((c) => String(c.tiploc).toUpperCase()));
  let current = spine.map((c, seq) => ({ ...c, seq }));
  let inserted = 0;

  for (let p = 0; p < passes; p++) {
    const { calls: next, inserted: n } = densifyCallsOnePass(current, index, opts, exclude);
    inserted += n;
    current = next;
    if (!n) break;
  }

  return { calls: current, inserted };
}

export function loadGeoIndexFromCatalog(dataDir) {
  const catalog = openCatalog(dataDir);
  const rows = catalog.prepare(`SELECT tiploc, lat, lon FROM tiploc_geo`).all();
  catalog.close();
  return buildGeoIndex(rows);
}

export async function densifyIntermediateGeometryForDay(dataDir, dayYmd, opts = {}) {
  const index = opts.index || loadGeoIndexFromCatalog(dataDir);
  if (!index.byTpl.size) return { services: 0, inserted: 0, tipocs: 0 };

  const stationCrs = opts.stationCrs || loadStationCrsSet(dataDir);
  const tipocMeta = opts.tipocMeta || loadTiplocMeta(dataDir);
  let validatedMids = opts.validatedMids || null;
  if (!validatedMids && opts.scheduleFile) {
    validatedMids = await mineValidatedMidsFromScheduleFile(opts.scheduleFile);
  }

  const densifyOpts = { ...opts, stationCrs, tipocMeta, validatedMids };

  const catalog = openCatalog(dataDir);
  const crsStmt = catalog.prepare(`SELECT crs FROM tiploc WHERE tiploc = ?`);
  const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
  const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
  const resolveCrs = (tpl) => crsStmt.get(String(tpl).toUpperCase())?.crs || null;
  const resolveName = (crs, tpl) =>
    (crs && nameByCrs.get(crs)?.name) ||
    (tpl && nameByTpl.get(String(tpl).toUpperCase())?.name) ||
    null;

  const db = openDayDb(dataDir, dayYmd);
  db.exec("PRAGMA busy_timeout=300000");
  const svcs = db
    .prepare(
      `SELECT rid FROM services
       WHERE length(rid)=15 AND rid GLOB '[0-9]*'`,
    )
    .all();
  const locStmt = db.prepare(`SELECT * FROM calls WHERE rid = ? ORDER BY seq`);
  const delCalls = db.prepare(`DELETE FROM calls WHERE rid = ?`);

  const beginImmediate = () => {
    db.exec("BEGIN IMMEDIATE");
  };

  let services = 0;
  let inserted = 0;
  // Per-service transactions so densify can coexist with stomp/ingest writers.
  for (const svc of svcs) {
    const before = locStmt.all(svc.rid);
    if (before.length < 2) continue;
    const { calls: filled, inserted: n } = densifyCallsWithGeometry(before, index, densifyOpts);
    if (!n) continue;
    beginImmediate();
    try {
      const live = snapshotCallLive(db, svc.rid);
      delCalls.run(svc.rid);
      for (const row of filled) {
        const payload = row.geomPass
          ? {
              rid: svc.rid,
              tiploc: row.tiploc,
              crs: resolveCrs(row.tiploc),
              seq: row.seq,
              is_passing: 1,
              cancelled: 0,
              platform: null,
              length_cars: null,
              formation: null,
              sta: null,
              std: null,
              wta: null,
              wtd: null,
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
        delete payload.geomPass;
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
    inserted += n;
  }
  beginImmediate();
  try {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('geom_densify_at', ?)`).run(
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
  return { services, inserted, tipocs: index.byTpl.size };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ymd = process.argv[2] || operatingDayYmd();
  const DATA_DIR = process.env.DATA_DIR ?? "./data";
  const scheduleFile = process.env.TT_SCHEDULE_FILE || null;
  const out = await densifyIntermediateGeometryForDay(DATA_DIR, ymd, { scheduleFile });
  console.log(
    `geometry-densify ${ymd} services=${out.services} inserted=${out.inserted} tipocs=${out.tipocs}`,
  );
}
