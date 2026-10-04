#!/usr/bin/env node
/**
 * Offline UK tipoc rail graph path stitcher.
 *
 * Only inserts intermediate TIPLOCs that already exist in catalog (with geo)
 * and lie on the shortest path between consecutive *known* tipocs
 * (ITPS/Darwin spine ∪ TRUST ∪ TD/SMART). Never invents free CRS stations.
 *
 * Edge metres prefer stored ORM track length; schedule/geo edges use tipoc-to-tipoc
 * haversine as a stand-in until a full OpenRailwayMap rail extract is imported.
 */
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
import {
  buildGeoIndex,
  candidatesNearSegment,
  distToSegmentM,
  haversineM,
  isNonPassengerLocation,
  loadTiplocMeta,
} from "./geometry-densify.js";
import {
  callClock,
  ensureTiplocGraphTable,
  interpolateHm,
  loadAdjFromCatalog,
} from "./tiploc-graph.js";

export const DEFAULT_MAX_HOPS = 4;
export const DEFAULT_MAX_EDGE_M = 4500;
export const DEFAULT_KNN = 6;
/** Corridor fill between consecutive spine tipocs (Holbeck / Cottingley / Batley). */
export const DEFAULT_CORRIDOR_OFFSET_M = 650;
/** Allow near-endpoint CRS/junctions (Mirfield ~24 m past Mirfield East). */
export const DEFAULT_CORRIDOR_MIN_PROG_M = 20;
export const DEFAULT_CORRIDOR_SPACING_M = 400;
export const DEFAULT_CORRIDOR_MAX_MIDS = 3;
export const DEFAULT_CORRIDOR_MIN_GAP_M = 2000;
/** Reject graph paths that detour far off the chord (Wakefield via). */
export const DEFAULT_MAX_PATH_DETOUR = 1.2;

export function ensureOrmTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orm_edges (
      from_tpl TEXT NOT NULL,
      to_tpl TEXT NOT NULL,
      metres REAL NOT NULL,
      source TEXT,
      PRIMARY KEY (from_tpl, to_tpl)
    );
    CREATE INDEX IF NOT EXISTS idx_orm_edges_from ON orm_edges (from_tpl);
  `);
}

function addDirected(adj, a, b, metres) {
  if (!a || !b || a === b || !Number.isFinite(metres) || metres <= 0) return;
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push({ to: b, metres });
}

/** Build adjacency from catalog orm_edges (rows are stored both ways). */
export function loadOrmAdj(dataDir) {
  const catalog = openCatalog(dataDir);
  ensureOrmTables(catalog);
  const rows = catalog.prepare(`SELECT from_tpl, to_tpl, metres FROM orm_edges`).all();
  catalog.close();
  const adj = new Map();
  for (const row of rows) {
    addDirected(adj, String(row.from_tpl).toUpperCase(), String(row.to_tpl).toUpperCase(), Number(row.metres));
  }
  return adj;
}

export function loadGeoByTpl(dataDir) {
  const catalog = openCatalog(dataDir);
  const rows = catalog.prepare(`SELECT tiploc, lat, lon FROM tiploc_geo`).all();
  catalog.close();
  const byTpl = new Map();
  for (const row of rows) {
    const t = String(row.tiploc || "").toUpperCase();
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!t || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    byTpl.set(t, { tiploc: t, lat, lon });
  }
  return byTpl;
}

/**
 * At most one junction tipoc that forms A—N—B with both edges, on the AB corridor.
 * Only when a direct A—B chord exists and is slightly shorter than via N (Holbeck case).
 */
export function triangleCorridorMids(
  adj,
  from,
  to,
  { tipocMeta = null, geoByTpl = null, maxOffsetM = 550, maxDetour = 1.15, minChordM = 1500 } = {},
) {
  const aTpl = String(from || "").toUpperCase();
  const bTpl = String(to || "").toUpperCase();
  if (!aTpl || !bTpl || !geoByTpl) return [];
  const a = geoByTpl.get(aTpl);
  const b = geoByTpl.get(bTpl);
  if (!a || !b) return [];
  const ab = haversineM(a, b);
  if (ab < minChordM) return [];
  // Only fill skipped junctions when a direct chord edge exists.
  if (!(adj.get(aTpl) || []).some((x) => x.to === bTpl)) return [];

  let best = null;
  const seen = new Set();
  for (const e of adj.get(aTpl) || []) {
    const n = e.to;
    if (!n || n === bTpl || n === aTpl || seen.has(n)) continue;
    seen.add(n);
    if (isPassengerCrsTiploc(n, tipocMeta)) continue;
    if (tipocMeta && isNonPassengerLocation(n, tipocMeta.get(n) || {})) continue;
    if (!(adj.get(n) || []).some((x) => x.to === bTpl)) continue;
    const p = geoByTpl.get(n);
    if (!p) continue;
    const { offsetM, t } = distToSegmentM(p, a, b);
    if (offsetM > maxOffsetM) continue;
    if (t <= 0.05 || t >= 0.95) continue;
    const via = haversineM(a, p) + haversineM(p, b);
    if (via <= ab || via > ab * maxDetour) continue;
    if (!best || offsetM < best.offsetM || (offsetM === best.offsetM && t < best.t)) {
      best = { tiploc: n, t, offsetM };
    }
  }
  return best ? [best.tiploc] : [];
}

/**
 * Rebuild orm_edges from schedule tipoc_edges + tipoc_geo kNN among eligible tipocs.
 * @returns {number} edge count (directed pairs stored undirected once each way as two rows)
 */
export function rebuildOrmGraphFromCatalog(dataDir, opts = {}) {
  const maxEdgeM = opts.maxEdgeM ?? DEFAULT_MAX_EDGE_M;
  const knn = opts.knn ?? DEFAULT_KNN;
  const catalog = openCatalog(dataDir);
  ensureOrmTables(catalog);
  ensureTiplocGraphTable(catalog);

  const geoRows = catalog.prepare(`SELECT tiploc, lat, lon FROM tiploc_geo`).all();
  const byTpl = new Map();
  for (const row of geoRows) {
    const t = String(row.tiploc || "").toUpperCase();
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!t || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    byTpl.set(t, { tiploc: t, lat, lon });
  }

  const tipocMeta = loadTiplocMeta(dataDir);
  const eligible = [...byTpl.keys()].filter(
    (t) => !isNonPassengerLocation(t, tipocMeta.get(t) || {}),
  );

  /** @type {Map<string, number>} */
  const edgeMap = new Map();
  const put = (a, b, metres, _source) => {
    if (!a || !b || a === b) return;
    if (!byTpl.has(a) || !byTpl.has(b)) return;
    if (!Number.isFinite(metres) || metres <= 0 || metres > maxEdgeM * 3) return;
    const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
    const prev = edgeMap.get(key);
    if (prev == null || metres < prev) edgeMap.set(key, metres);
  };

  // Schedule-mined tipoc pairs (strong evidence of a rail connection).
  const sched = catalog.prepare(`SELECT from_tpl, to_tpl FROM tiploc_edges`).all();
  for (const row of sched) {
    const a = String(row.from_tpl || "").toUpperCase();
    const b = String(row.to_tpl || "").toUpperCase();
    const pa = byTpl.get(a);
    const pb = byTpl.get(b);
    if (!pa || !pb) continue;
    put(a, b, haversineM(pa, pb), "schedule");
  }

  // Local kNN among eligible tipocs — fills junctions (e.g. Holbeck) between spine tipocs.
  const pts = eligible.map((t) => byTpl.get(t)).filter(Boolean);
  for (const p of pts) {
    const near = [];
    for (const q of pts) {
      if (q.tiploc === p.tiploc) continue;
      const d = haversineM(p, q);
      if (d > 0 && d <= maxEdgeM) near.push({ t: q.tiploc, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const n of near.slice(0, knn)) put(p.tiploc, n.t, n.d, "geo-knn");
  }

  catalog.exec("BEGIN");
  catalog.exec("DELETE FROM orm_edges");
  const ins = catalog.prepare(
    `INSERT INTO orm_edges (from_tpl, to_tpl, metres, source) VALUES (?, ?, ?, ?)`,
  );
  let n = 0;
  for (const [key, metres] of edgeMap) {
    const [a, b] = key.split("\t");
    ins.run(a, b, metres, "catalog");
    ins.run(b, a, metres, "catalog");
    n += 2;
  }
  catalog.exec("COMMIT");
  catalog.close();
  return n;
}

function isPassengerCrsTiploc(tpl, tipocMeta) {
  if (!tipocMeta) return false;
  const meta = tipocMeta.get(String(tpl || "").toUpperCase());
  const crs = String(meta?.crs || "").trim().toUpperCase();
  return Boolean(crs) && !crs.startsWith("X");
}

function isJunctionName(meta = {}) {
  return /\bjn\b|junction/i.test(String(meta.name || ""));
}

/**
 * Tipocs on the spatial corridor between consecutive known spine tipocs.
 * Junctions on-chord are always eligible. CRS stations need a schedule edge
 * to A or B (other trains prove the tipoc sits on this corridor).
 */
export function corridorGeometryMids(
  from,
  to,
  { tipocMeta = null, geoByTpl = null, geoIndex = null, scheduleAdj = null } = {},
) {
  const aTpl = String(from || "").toUpperCase();
  const bTpl = String(to || "").toUpperCase();
  if (!aTpl || !bTpl || !geoByTpl) return [];
  const a = geoByTpl.get(aTpl);
  const b = geoByTpl.get(bTpl);
  if (!a || !b) return [];
  const ab = haversineM(a, b);
  if (ab < DEFAULT_CORRIDOR_MIN_GAP_M) return [];

  const index =
    geoIndex ||
    buildGeoIndex(
      [...geoByTpl.values()].map((p) => ({ tiploc: p.tiploc, lat: p.lat, lon: p.lon })),
    );

  const schedTouch = (tpl) => {
    if (!scheduleAdj) return true;
    const nA = scheduleAdj.get(aTpl) || [];
    const nB = scheduleAdj.get(bTpl) || [];
    return nA.some((x) => x.to === tpl) || nB.some((x) => x.to === tpl);
  };

  const hits = [];
  for (const pt of candidatesNearSegment(index, a, b)) {
    if (pt.tiploc === aTpl || pt.tiploc === bTpl) continue;
    const meta = tipocMeta?.get(pt.tiploc) || {};
    if (isNonPassengerLocation(pt.tiploc, meta)) continue;
    const crs = String(meta.crs || "").trim();
    const junction = !crs || isJunctionName(meta);
    // Passenger CRS needs schedule adjacency to an endpoint (not free invent).
    if (crs && !crs.toUpperCase().startsWith("X") && !junction && !schedTouch(pt.tiploc)) continue;
    const { offsetM, t } = distToSegmentM(pt, a, b);
    if (offsetM > DEFAULT_CORRIDOR_OFFSET_M) continue;
    if (t <= 0.02 || t >= 0.98) continue;
    const at = haversineM(a, pt);
    const tb = haversineM(pt, b);
    if (at < DEFAULT_CORRIDOR_MIN_PROG_M || tb < DEFAULT_CORRIDOR_MIN_PROG_M) continue;
    if (at + tb > ab * 1.2) continue;
    hits.push({ tiploc: pt.tiploc, t, at, offsetM, junction: Boolean(junction || !crs) });
  }
  // Prefer junctions, then lower offset.
  hits.sort((x, y) => Number(y.junction) - Number(x.junction) || x.t - y.t || x.offsetM - y.offsetM);

  const picked = [];
  let lastAt = -DEFAULT_CORRIDOR_SPACING_M;
  const ordered = [...hits].sort((x, y) => x.t - y.t || x.offsetM - y.offsetM);
  for (const h of ordered) {
    if (h.at - lastAt < DEFAULT_CORRIDOR_SPACING_M) continue;
    picked.push(h.tiploc);
    lastAt = h.at;
    if (picked.length >= DEFAULT_CORRIDOR_MAX_MIDS) break;
  }
  return picked;
}

/**
 * Dijkstra shortest path. Returns { path: tipocs inclusive, metres } or null.
 * Skips non-passenger / junk tipocs as intermediates.
 */
export function shortestOrmPath(adj, from, to, { maxHops = DEFAULT_MAX_HOPS, tipocMeta = null } = {}) {
  const start = String(from || "").toUpperCase();
  const goal = String(to || "").toUpperCase();
  if (!start || !goal || start === goal) return null;
  if (!adj.has(start) || !adj.has(goal)) return null;

  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const hops = new Map([[start, 0]]);
  /** @type {Set<string>} */
  const open = new Set([start]);

  while (open.size) {
    let u = null;
    let best = Infinity;
    for (const n of open) {
      const d = dist.get(n) ?? Infinity;
      if (d < best) {
        best = d;
        u = n;
      }
    }
    if (u == null) break;
    open.delete(u);
    if (u === goal) break;
    const h = hops.get(u) ?? 0;
    if (h >= maxHops) continue;
    for (const e of adj.get(u) || []) {
      const next = e.to;
      if (
        next !== goal &&
        next !== start &&
        tipocMeta &&
        isNonPassengerLocation(next, tipocMeta.get(next) || {})
      ) {
        continue;
      }
      const alt = best + e.metres;
      const prevD = dist.get(next);
      if (prevD == null || alt < prevD) {
        dist.set(next, alt);
        prev.set(next, u);
        hops.set(next, h + 1);
        open.add(next);
      }
    }
  }

  if (!dist.has(goal)) return null;
  const path = [];
  for (let cur = goal; cur; cur = prev.get(cur)) {
    path.push(cur);
    if (cur === start) break;
  }
  path.reverse();
  if (path[0] !== start) return null;
  return { path, metres: dist.get(goal) };
}

/** Intermediate tipocs only (excludes from/to). */
export function ormIntermediatePath(adj, from, to, opts = {}) {
  const tipocMeta = opts.tipocMeta || null;
  const geoByTpl = opts.geoByTpl;
  const geoIndex = opts.geoIndex || null;
  const maxDetour = opts.maxPathDetour ?? DEFAULT_MAX_PATH_DETOUR;
  const aTpl = String(from || "").toUpperCase();
  const bTpl = String(to || "").toUpperCase();
  const a = geoByTpl?.get(aTpl);
  const b = geoByTpl?.get(bTpl);
  const ab = a && b ? haversineM(a, b) : null;

  // Primary: tipocs on the chord between consecutive spine tipocs.
  const corridor = corridorGeometryMids(aTpl, bTpl, {
    tipocMeta,
    geoByTpl,
    geoIndex,
    scheduleAdj: opts.scheduleAdj || null,
  });

  // Secondary: short on-corridor graph path (no Wakefield-scale detours).
  const hit = shortestOrmPath(adj, aTpl, bTpl, opts);
  const graphMids = [];
  if (hit?.path?.length >= 3 && ab != null && hit.metres <= ab * maxDetour) {
    for (const tpl of hit.path.slice(1, -1)) {
      if (tipocMeta && isNonPassengerLocation(tpl, tipocMeta.get(tpl) || {})) continue;
      if (a && b && geoByTpl?.get(tpl)) {
        const { offsetM } = distToSegmentM(geoByTpl.get(tpl), a, b);
        if (offsetM > DEFAULT_CORRIDOR_OFFSET_M) continue;
      }
      graphMids.push(tpl);
    }
  }

  const triangles = triangleCorridorMids(adj, aTpl, bTpl, opts);
  if (!corridor.length && !graphMids.length && !triangles.length) {
    return hit && Number.isFinite(hit.metres)
      ? { mids: [], metres: hit.metres, path: [aTpl, bTpl] }
      : ab != null
        ? { mids: [], metres: ab, path: [aTpl, bTpl] }
        : null;
  }

  const mids = [];
  const seen = new Set();
  const push = (tpl) => {
    const t = String(tpl || "").toUpperCase();
    if (!t || seen.has(t)) return;
    if (tipocMeta && isNonPassengerLocation(t, tipocMeta.get(t) || {})) return;
    seen.add(t);
    mids.push(t);
  };
  for (const tpl of corridor) push(tpl);
  for (const tpl of graphMids) push(tpl);
  for (const tpl of triangles) push(tpl);

  if (a && b && mids.length > 1) {
    mids.sort((x, y) => {
      const px = geoByTpl.get(x);
      const py = geoByTpl.get(y);
      if (!px || !py) return 0;
      return distToSegmentM(px, a, b).t - distToSegmentM(py, a, b).t;
    });
  }

  let metres = ab;
  if (mids.length && a && b) {
    let sum = 0;
    let prev = a;
    for (const tpl of mids) {
      const p = geoByTpl.get(tpl);
      if (!p) continue;
      sum += haversineM(prev, p);
      prev = p;
    }
    sum += haversineM(prev, b);
    metres = sum;
  } else if (hit && Number.isFinite(hit.metres)) {
    metres = hit.metres;
  }

  return {
    mids,
    metres: metres ?? null,
    path: [aTpl, ...mids, bTpl],
  };
}

/**
 * Stitch known tipocs with ORM mids; attach leg_m / cum_m along the path.
 * Known tipocs = existing calls (caller should strip densify ghosts via ITPS re-overlay first).
 */
export function stitchCallsWithOrmPath(calls, adj, opts = {}) {
  const tipocMeta = opts.tipocMeta || null;
  const geoByTpl = opts.geoByTpl || null;
  const geoIndex = opts.geoIndex || null;
  const scheduleAdj = opts.scheduleAdj || null;
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const spine = (calls || []).filter((c) => c?.tiploc);
  if (spine.length < 2) {
    return { calls: spine.map((c, seq) => ({ ...c, seq, leg_m: null, cum_m: null })), inserted: 0 };
  }

  const out = [];
  let inserted = 0;
  let cum = 0;

  for (let i = 0; i < spine.length; i++) {
    const cur = { ...spine[i] };
    if (i === 0) {
      cur.leg_m = null;
      cur.cum_m = 0;
      out.push(cur);
      continue;
    }
    const a = String(spine[i - 1].tiploc).toUpperCase();
    const b = String(cur.tiploc).toUpperCase();
    const hit = ormIntermediatePath(adj, a, b, {
      maxHops,
      tipocMeta,
      geoByTpl,
      geoIndex,
      scheduleAdj,
    });
    const t0 = callClock(spine[i - 1]);
    const t1 = callClock(cur);

    if (hit?.mids?.length) {
      const segMetres = hit.metres;
      const stepM = hit.mids.length + 1;
      // Distribute path metres across mid legs + final leg proportionally by hop count.
      const perHop = segMetres / stepM;
      for (let j = 0; j < hit.mids.length; j++) {
        const tpl = hit.mids[j];
        cum += perHop;
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
          wtp: interpolateHm(t0, t1, j, hit.mids.length),
          live_kind: "scheduled",
          actual_source: "orm",
          ormPass: true,
          leg_m: perHop,
          cum_m: cum,
        });
        inserted++;
      }
      cum += perHop;
      cur.leg_m = perHop;
      cur.cum_m = cum;
    } else if (hit && Number.isFinite(hit.metres)) {
      cum += hit.metres;
      cur.leg_m = hit.metres;
      cur.cum_m = cum;
    } else {
      cur.leg_m = null;
      cur.cum_m = cum || null;
    }
    out.push(cur);
  }

  return { calls: out.map((c, seq) => ({ ...c, seq })), inserted };
}

export function metresToMiles(m) {
  if (m == null || !Number.isFinite(Number(m))) return null;
  return Math.round((Number(m) / 1609.344) * 100) / 100;
}

export function stitchOrmPathsForDay(dataDir, dayYmd, opts = {}) {
  let adj = loadOrmAdj(dataDir);
  if (!adj.size || opts.rebuild) {
    rebuildOrmGraphFromCatalog(dataDir, opts);
    adj = loadOrmAdj(dataDir);
  }
  // Fallback: if ORM empty, seed from schedule adj with geo lengths via rebuild.
  if (!adj.size) {
    // Ensure schedule edges exist in catalog when a schedule file was just mined.
    loadAdjFromCatalog(dataDir, { minEdge: 1 });
    rebuildOrmGraphFromCatalog(dataDir, opts);
    adj = loadOrmAdj(dataDir);
  }
  if (!adj.size) return { services: 0, inserted: 0, edges: 0 };

  const tipocMeta = opts.tipocMeta || loadTiplocMeta(dataDir);
  const geoByTpl = opts.geoByTpl || loadGeoByTpl(dataDir);
  const geoIndex =
    opts.geoIndex ||
    buildGeoIndex([...geoByTpl.values()].map((p) => ({ tiploc: p.tiploc, lat: p.lat, lon: p.lon })));
  // Low minEdge so rare but real schedule adjacencies still gate CRS corridor fills.
  const scheduleAdj = opts.scheduleAdj || loadAdjFromCatalog(dataDir, { minEdge: 1 });
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

  let services = 0;
  let inserted = 0;
  for (const svc of svcs) {
    const raw = locStmt.all(svc.rid);
    // Drop prior ORM inserts so restitch does not compound triangle mids.
    const before = raw.filter((c) => String(c.actual_source || "") !== "orm");
    if (before.length < 2) continue;
    const { calls: filled, inserted: n } = stitchCallsWithOrmPath(before, adj, {
      tipocMeta,
      geoByTpl,
      geoIndex,
      scheduleAdj,
      maxHops: opts.maxHops ?? DEFAULT_MAX_HOPS,
    });
    const mileageChanged = filled.some(
      (c, i) => c.leg_m !== before[i]?.leg_m || c.cum_m !== before[i]?.cum_m,
    );
    if (!n && !mileageChanged && filled.length === before.length && before.length === raw.length) continue;

    db.exec("BEGIN IMMEDIATE");
    try {
      const live = snapshotCallLive(db, svc.rid);
      delCalls.run(svc.rid);
      for (const row of filled) {
        const payload = row.ormPass
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
              actual_source: "orm",
              leg_m: row.leg_m ?? null,
              cum_m: row.cum_m ?? null,
              updated_at: Date.now(),
            }
          : {
              ...row,
              rid: svc.rid,
              seq: row.seq,
              leg_m: row.leg_m ?? null,
              cum_m: row.cum_m ?? null,
            };
        delete payload.ormPass;
        upsertCall(db, payload);
      }
      if (live.length) restoreCallLive(db, svc.rid, live);
      // Re-apply mileage after upsert (upsert may not know columns yet on old payloads).
      const upd = db.prepare(`UPDATE calls SET leg_m = ?, cum_m = ? WHERE rid = ? AND tiploc = ?`);
      for (const row of filled) {
        upd.run(row.leg_m ?? null, row.cum_m ?? null, svc.rid, row.tiploc);
      }
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
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('orm_path_at', ?)`).run(
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
  return { services, inserted, edges: adj.size };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const ymd = process.argv[2] || operatingDayYmd();
  const DATA_DIR = process.env.DATA_DIR ?? "./data";
  const rebuild = String(process.env.TT_ORM_REBUILD || "1").trim() !== "0";
  if (rebuild) {
    const n = rebuildOrmGraphFromCatalog(DATA_DIR);
    console.log("orm edges", n);
  }
  const out = stitchOrmPathsForDay(DATA_DIR, ymd, { rebuild: false });
  console.log(`orm-path ${ymd} services=${out.services} inserted=${out.inserted} edgeNodes=${out.edges}`);
}
