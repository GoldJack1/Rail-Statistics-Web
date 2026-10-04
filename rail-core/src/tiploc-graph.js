/**
 * Directed TIPLOC transition graph mined from ITPS/CIF location sequences.
 * Used to fill intermediate working passes Darwin omitted.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { openCatalog } from "./db.js";
import { openCifLines, scheduleJsonLocation } from "./cif-overlay.js";

export const DEFAULT_MAX_HOPS = 4;
export const DEFAULT_MIN_EDGE = 40;

export function ensureTiplocGraphTable(catalog) {
  catalog.exec(`
    CREATE TABLE IF NOT EXISTS tiploc_edges (
      from_tpl TEXT NOT NULL,
      to_tpl TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (from_tpl, to_tpl)
    );
    CREATE INDEX IF NOT EXISTS idx_tiploc_edges_from ON tiploc_edges (from_tpl, weight DESC);
  `);
}

export function addEdge(edges, from, to) {
  const a = String(from || "").trim().toUpperCase();
  const b = String(to || "").trim().toUpperCase();
  if (!a || !b || a === b) return;
  const key = `${a}\t${b}`;
  edges.set(key, (edges.get(key) || 0) + 1);
}

export function addPathEdges(edges, tipocs) {
  for (let i = 0; i < tipocs.length - 1; i++) addEdge(edges, tipocs[i], tipocs[i + 1]);
}

export async function mineEdgesFromCif(file, edges = new Map()) {
  let locs = [];
  for await (const line of openCifLines(file)) {
    const rec = line.slice(0, 2);
    if (rec === "BS") {
      if (locs.length > 1) addPathEdges(edges, locs);
      locs = [];
      continue;
    }
    if (rec === "LO" || rec === "LI" || rec === "LT") {
      const tpl = String(line.slice(2, 10)).trim().toUpperCase();
      if (tpl) locs.push(tpl);
    }
  }
  if (locs.length > 1) addPathEdges(edges, locs);
  return edges;
}

export async function mineEdgesFromJson(file, edges = new Map()) {
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
      const tipocs = [];
      for (const loc of Array.isArray(raw) ? raw : [raw]) {
        const parsed = scheduleJsonLocation(loc);
        if (parsed?.tiploc) tipocs.push(parsed.tiploc);
      }
      if (tipocs.length > 1) addPathEdges(edges, tipocs);
    }
  }
  return edges;
}

export async function mineEdgesFromScheduleFile(file) {
  if (/\.json$/i.test(file)) return mineEdgesFromJson(file);
  return mineEdgesFromCif(file);
}

export function saveEdgesToCatalog(dataDir, edges) {
  const catalog = openCatalog(dataDir);
  ensureTiplocGraphTable(catalog);
  catalog.exec("BEGIN");
  catalog.exec("DELETE FROM tiploc_edges");
  const ins = catalog.prepare(
    `INSERT INTO tiploc_edges (from_tpl, to_tpl, weight) VALUES (?, ?, ?)
     ON CONFLICT(from_tpl, to_tpl) DO UPDATE SET weight = excluded.weight`,
  );
  for (const [key, weight] of edges) {
    const [from, to] = key.split("\t");
    ins.run(from, to, weight);
  }
  catalog.exec("COMMIT");
  const n = catalog.prepare(`SELECT COUNT(*) AS n FROM tiploc_edges`).get().n;
  catalog.close();
  return n;
}

export function loadAdjFromCatalog(dataDir, { minEdge = DEFAULT_MIN_EDGE } = {}) {
  const catalog = openCatalog(dataDir);
  ensureTiplocGraphTable(catalog);
  const rows = catalog
    .prepare(`SELECT from_tpl, to_tpl, weight FROM tiploc_edges WHERE weight >= ?`)
    .all(minEdge);
  catalog.close();
  const adj = new Map();
  for (const row of rows) {
    if (!adj.has(row.from_tpl)) adj.set(row.from_tpl, []);
    adj.get(row.from_tpl).push({ to: row.to_tpl, weight: row.weight });
  }
  for (const list of adj.values()) list.sort((a, b) => b.weight - a.weight);
  return adj;
}

/**
 * Shortest simple path from → to with at most maxHops edges.
 * Among equal hop counts, prefer highest sum of log(edge weight).
 * Returns intermediate TIPLOCs only (excludes from/to), or null when
 * unreachable.
 *
 * Preferring fewest hops avoids junction detours (e.g. Dryclough Jn when
 * Milner Royd → Greetland is direct). When a direct edge exists,
 * `stationMids` may still insert a single CRS/station mid (Cottingley,
 * Batley) via a 2-hop path — junctions are not densified that way.
 */
export function bestIntermediatePath(adj, from, to, { maxHops = DEFAULT_MAX_HOPS, stationMids = null } = {}) {
  const start = String(from || "").toUpperCase();
  const goal = String(to || "").toUpperCase();
  if (!start || !goal || start === goal) return null;
  if (!adj.has(start)) return null;

  let best = null;
  let bestHops = Infinity;
  let bestScore = -Infinity;

  const stack = [{ node: start, route: [start], score: 0, seen: new Set([start]) }];
  while (stack.length) {
    const cur = stack.pop();
    const hops = cur.route.length - 1;
    if (hops > maxHops || hops > bestHops) continue;
    if (cur.node === goal && hops >= 1) {
      if (hops < bestHops || (hops === bestHops && cur.score > bestScore)) {
        bestHops = hops;
        bestScore = cur.score;
        best = hops > 1 ? cur.route.slice(1, -1) : null;
      }
      continue;
    }
    if (hops === maxHops || hops === bestHops) continue;
    const outs = adj.get(cur.node) || [];
    for (const edge of outs) {
      if (cur.seen.has(edge.to)) continue;
      const nextSeen = new Set(cur.seen);
      nextSeen.add(edge.to);
      stack.push({
        node: edge.to,
        route: [...cur.route, edge.to],
        score: cur.score + Math.log(edge.weight + 1),
        seen: nextSeen,
      });
    }
  }

  if (bestHops === 1 && stationMids?.size) {
    let mid = null;
    let midScore = -Infinity;
    for (const edge of adj.get(start) || []) {
      if (edge.to === goal || !stationMids.has(edge.to)) continue;
      const step = (adj.get(edge.to) || []).find((e) => e.to === goal);
      if (!step) continue;
      const score = Math.log(edge.weight + 1) + Math.log(step.weight + 1);
      if (score > midScore) {
        midScore = score;
        mid = edge.to;
      }
    }
    if (mid) return [mid];
  }

  return best;
}

/** TIPLOCs that have a CRS (stations / public locations), for densify-on-direct. */
export function loadStationTiplocsFromCatalog(dataDir) {
  const catalog = openCatalog(dataDir);
  const rows = catalog
    .prepare(
      `SELECT tiploc FROM tiploc
       WHERE crs IS NOT NULL AND TRIM(crs) != ''`,
    )
    .all();
  catalog.close();
  return new Set(rows.map((r) => String(r.tiploc).toUpperCase()));
}

export function interpolateHm(a, b, index, total) {
  const parse = (v) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const am = parse(a);
  const bm = parse(b);
  if (am == null || bm == null || total <= 0) return null;
  let delta = bm - am;
  // True overnight (e.g. 23:50 → 00:10). Small negative deltas are noisy/inverted
  // spine clocks — do not wrap into the next railway day (that floated densify rows).
  if (delta < -12 * 60) delta += 1440;
  else if (delta < 0) delta = 0;
  const mins = Math.round(am + (delta * (index + 1)) / (total + 1)) % 1440;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function callClock(c) {
  return c?.wtp || c?.wtd || c?.wta || c?.sta || c?.std || null;
}

/**
 * Insert graph intermediates between consecutive Darwin calls.
 * Does not insert TIPLOCs that look like public stops (caller filters).
 */
export function fillCallsWithGraph(calls, adj, opts = {}) {
  const maxHops = opts.maxHops ?? DEFAULT_MAX_HOPS;
  const stationMids = opts.stationMids ?? null;
  const out = [];
  let inserted = 0;
  for (let i = 0; i < calls.length; i++) {
    out.push(calls[i]);
    if (i === calls.length - 1) break;
    const a = String(calls[i].tiploc || "").toUpperCase();
    const b = String(calls[i + 1].tiploc || "").toUpperCase();
    const mids = bestIntermediatePath(adj, a, b, { maxHops, stationMids });
    if (!mids?.length) continue;
    const t0 = callClock(calls[i]);
    const t1 = callClock(calls[i + 1]);
    for (let j = 0; j < mids.length; j++) {
      const wtp = interpolateHm(t0, t1, j, mids.length);
      out.push({
        tiploc: mids[j],
        crs: null,
        is_passing: 1,
        cancelled: 0,
        platform: null,
        sta: null,
        std: null,
        wta: null,
        wtd: null,
        wtp,
        live_kind: "scheduled",
        actual_source: null,
        graphPass: true,
      });
      inserted++;
    }
  }
  return { calls: out.map((c, seq) => ({ ...c, seq })), inserted };
}
