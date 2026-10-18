/**
 * Passes the timetable does not book, compiled the way Railfeed describes it.
 * Schedule neighbours come first. A place is kept only when it also lies on
 * the GTCL path and is a current timing tip or a working-timetable link.
 * A junction drawn on the map is not enough. The clock is the booked
 * running time split by distance along that path.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { callClock } from "./tiploc-graph.js";

const NEAR_M = 40;
const SCHEDULE_M = 70;
const SNAP_M = 120;
const CELL = 200;

const PASSING =
  /jn|jcn|junction|loop|crossover|xover|level crossing|\bl\.?\s?c\.?\b|passing|apco|g\.?\s?s\.?\s?p|signal|\bs\.?\s?b\.?\b/i;
const JUNK = /siding|\bsdg\b|depot|shed|yard|colliery|power station|freight|goods|wharf|terminal|reception|metro/i;

let cached = null;
let cachedPath = "";
let tlkDb = null;
let tlkTipCache = null;

export function loadTlk(file) {
  if (!file || !existsSync(file)) return null;
  if (tlkDb) return tlkDb;
  tlkDb = new DatabaseSync(file, { readOnly: true });
  return tlkDb;
}

function tlkTips(db) {
  if (!db) return null;
  if (tlkTipCache) return tlkTipCache;
  tlkTipCache = new Set(db.prepare(`SELECT tiploc FROM tip`).all().map((row) => row.tiploc));
  return tlkTipCache;
}

function hopWeight(db, from, to, load, fallback) {
  if (!db) return fallback;
  const traction = String(load || "").trim().toUpperCase();
  const exact = traction
    ? db.prepare(`SELECT secs FROM srt WHERE a = ? AND b = ? AND traction = ? LIMIT 1`).get(from, to, traction)
    : null;
  const any = exact || db.prepare(`SELECT secs FROM srt WHERE a = ? AND b = ? LIMIT 1`).get(from, to);
  return any?.secs > 0 ? any.secs : fallback;
}

export function loadGtclGraph(file) {
  if (!file || !existsSync(file)) return null;
  if (cached && cachedPath === file) return cached;
  const db = new DatabaseSync(file, { readOnly: true });
  const edges = db.prepare(`SELECT ax, ay, bx, by, len FROM edges`).all();
  db.close();
  const adj = new Map();
  const add = (x, y, edge) => {
    const k = `${x},${y}`;
    const list = adj.get(k);
    if (list) list.push(edge);
    else adj.set(k, [edge]);
  };
  for (const e of edges) {
    add(e.ax, e.ay, e);
    add(e.bx, e.by, e);
  }
  cached = { edges, adj };
  cachedPath = file;
  return cached;
}

function clockAt(a, b, fraction) {
  const parse = (v) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const am = parse(a);
  const bm = parse(b);
  if (am == null || bm == null) return null;
  let delta = bm - am;
  if (delta < -12 * 60) delta += 1440;
  else if (delta < 0) delta = 0;
  const mins = Math.round(am + delta * fraction) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function keepLocation(loc) {
  const name = loc.name || "";
  if (!name || JUNK.test(name) || /\d/.test(loc.tiploc)) return false;
  const crs = loc.crs || "";
  if (crs.length === 3 && !crs.startsWith("X")) return true;
  return PASSING.test(name);
}

function locKey(loc) {
  return `${Math.floor(loc.e / CELL)},${Math.floor(loc.n / CELL)}`;
}

function indexLocations(locs) {
  const grid = new Map();
  for (const loc of locs) {
    const list = grid.get(locKey(loc));
    if (list) list.push(loc);
    else grid.set(locKey(loc), [loc]);
  }
  return { locs, grid };
}

function isPublicCrs(loc) {
  const crs = String(loc?.crs || "");
  return crs.length === 3 && !crs.startsWith("X");
}

/**
 * A compass junction drawn more than 1.2 km from its own station, while the
 * station and the other same-name neighbours sit together, is on the wrong
 * siding. Bletchley South is the case: the plot is south of Drayton Road, and
 * every Bletchley neighbour is up at the station.
 */
export function anchorIsolatedPlaces(locs, pairs) {
  const nbr = new Map();
  const link = (a, b) => {
    const from = String(a || "").toUpperCase();
    const to = String(b || "").toUpperCase();
    if (!from || !to || from === to) return;
    if (!nbr.has(from)) nbr.set(from, new Set());
    nbr.get(from).add(to);
  };
  for (const [a, b] of pairs || []) {
    link(a, b);
    link(b, a);
  }
  const by = new Map(locs.map((loc) => [loc.tiploc, loc]));
  for (const loc of locs) {
    if (isPublicCrs(loc) || !compassSide(loc.name)) continue;
    const near = [];
    for (const other of nbr.get(loc.tiploc) || []) {
      const there = by.get(other);
      if (!there) continue;
      const d = Math.hypot(there.e - loc.e, there.n - loc.n);
      if (d < 40 || d > 4000 || !samePlaceName(loc.name, there.name)) continue;
      near.push(there);
    }
    if (near.length < 2 || !near.some(isPublicCrs)) continue;
    const span = Math.max(
      Math.max(...near.map((p) => p.e)) - Math.min(...near.map((p) => p.e)),
      Math.max(...near.map((p) => p.n)) - Math.min(...near.map((p) => p.n)),
    );
    if (span > 800) continue;
    const station = near.find(isPublicCrs);
    const e = near.reduce((sum, p) => sum + p.e, 0) / near.length;
    const n = near.reduce((sum, p) => sum + p.n, 0) / near.length;
    if (Math.hypot(e - loc.e, n - loc.n) < 1200 || !station) continue;
    // Sit just on the plotted side of the station, so the point stays on the
    // running line instead of in the middle of the sidings.
    const dx = loc.e - station.e;
    const dy = loc.n - station.n;
    const len = Math.hypot(dx, dy) || 1;
    loc.e = station.e + (dx / len) * 200;
    loc.n = station.n + (dy / len) * 200;
  }
  return locs;
}

function loadLocations(catalog) {
  const rows = catalog
    .prepare(
      `SELECT g.tiploc, g.easting AS e, g.northing AS n, t.name, t.crs
       FROM tiploc_geo g
       LEFT JOIN tiploc t ON t.tiploc = g.tiploc
       WHERE g.easting IS NOT NULL AND g.northing IS NOT NULL`,
    )
    .all();
  const locs = [];
  for (const row of rows) {
    const loc = {
      tiploc: String(row.tiploc || "").toUpperCase(),
      name: row.name || "",
      crs: String(row.crs || "").trim().toUpperCase(),
      e: Number(row.e),
      n: Number(row.n),
    };
    if (!loc.tiploc || !Number.isFinite(loc.e)) continue;
    locs.push(loc);
  }
  let links = [];
  try {
    links = catalog.prepare(`SELECT from_tpl, to_tpl FROM nwk_edges`).all();
  } catch {
    links = [];
  }
  anchorIsolatedPlaces(
    locs,
    links.map((row) => [row.from_tpl, row.to_tpl]),
  );
  return indexLocations(locs);
}

let railCache = null;
function railLinks(catalog) {
  if (railCache) return railCache;
  const nbr = new Map();
  const link = (a, b) => {
    const from = String(a || "").toUpperCase();
    const to = String(b || "").toUpperCase();
    if (!from || !to || from === to) return;
    if (!nbr.has(from)) nbr.set(from, new Set());
    nbr.get(from).add(to);
  };
  for (const row of catalog.prepare(`SELECT from_tpl, to_tpl FROM nwk_edges`).all()) link(row.from_tpl, row.to_tpl);
  const schedule = new Set();
  for (const row of catalog.prepare(`SELECT from_tpl, to_tpl FROM tiploc_edges`).all()) {
    link(row.from_tpl, row.to_tpl);
    schedule.add(String(row.from_tpl || "").toUpperCase());
    schedule.add(String(row.to_tpl || "").toUpperCase());
  }
  railCache = { nbr, schedule };
  return railCache;
}

let locCache = null;
function locations(catalog) {
  if (locCache) return locCache;
  locCache = loadLocations(catalog);
  return locCache;
}

function snapCandidates(graph, e, n, toward) {
  const found = [];
  const seen = new Set();
  const x0 = Math.floor(e / CELL);
  const y0 = Math.floor(n / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const edge of graph.cell.get(`${x0 + dx},${y0 + dy}`) || []) {
        for (const [x, y] of [
          [edge.ax, edge.ay],
          [edge.bx, edge.by],
        ]) {
          const key = `${x},${y}`;
          if (seen.has(key)) continue;
          const d = (x - e) ** 2 + (y - n) ** 2;
          if (d > SNAP_M * SNAP_M) continue;
          seen.add(key);
          const onward = toward ? Math.hypot(x - toward.e, y - toward.n) : 0;
          found.push({ key, score: onward * 1000 + d });
        }
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  return found.slice(0, 6);
}

function ensureCells(graph) {
  if (graph.cell) return;
  const cell = new Map();
  for (const edge of graph.edges) {
    const x0 = Math.floor(Math.min(edge.ax, edge.bx) / CELL);
    const x1 = Math.floor(Math.max(edge.ax, edge.bx) / CELL);
    const y0 = Math.floor(Math.min(edge.ay, edge.by) / CELL);
    const y1 = Math.floor(Math.max(edge.ay, edge.by) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = cell.get(k);
        if (list) list.push(edge);
        else cell.set(k, [edge]);
      }
    }
  }
  graph.cell = cell;
}

function route(graph, fromKey, toKey, maxLen = Infinity) {
  if (fromKey === toKey) return [];
  const dist = new Map([[fromKey, 0]]);
  const prev = new Map();
  const heap = [[0, fromKey]];
  const less = (i, j) => heap[i][0] < heap[j][0];
  const swap = (i, j) => {
    const t = heap[i];
    heap[i] = heap[j];
    heap[j] = t;
  };
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p);
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      let s = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < heap.length && less(l, s)) s = l;
      if (r < heap.length && less(r, s)) s = r;
      if (s === i) break;
      swap(i, s);
      i = s;
    }
  };
  const push = (item) => {
    heap.push(item);
    up(heap.length - 1);
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      down(0);
    }
    return top;
  };
  while (heap.length) {
    const [d, key] = pop();
    if (d !== dist.get(key)) continue;
    if (key === toKey) break;
    if (d > maxLen) break;
    for (const edge of graph.adj.get(key) || []) {
      const next = `${edge.ax},${edge.ay}` === key ? `${edge.bx},${edge.by}` : `${edge.ax},${edge.ay}`;
      const nd = d + edge.len;
      if (nd > maxLen) continue;
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd);
        prev.set(next, { key, edge });
        push([nd, next]);
      }
    }
  }
  if (!prev.has(toKey) && fromKey !== toKey) return null;
  const nodes = [toKey];
  const edges = [];
  let cur = toKey;
  while (cur !== fromKey) {
    const step = prev.get(cur);
    if (!step) return null;
    edges.push(step.edge);
    cur = step.key;
    nodes.push(cur);
  }
  edges.reverse();
  return edges;
}

function placeWords(name) {
  return new Set(
    String(name || "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !/junction|north|south|east|west|loop|crossover/.test(w)),
  );
}

function samePlaceName(a, b) {
  const words = placeWords(a);
  for (const w of placeWords(b)) if (words.has(w)) return true;
  return false;
}

const ROUTE_OFF_M = 80;

function isScheduleCall(call) {
  return Boolean(call?.wtp || call?.wtd || call?.wta || call?.sta || call?.std || call?.ptd || call?.pta);
}

function pathEdges(graph, a, b) {
  ensureCells(graph);
  const straight = Math.hypot(a.e - b.e, a.n - b.n);
  const maxLen = straight * 1.8 + 400;
  for (const from of snapCandidates(graph, a.e, a.n, b).slice(0, 3)) {
    for (const to of snapCandidates(graph, b.e, b.n, a).slice(0, 3)) {
      const walked = route(graph, from.key, to.key, maxLen);
      if (walked?.length) return walked;
    }
  }
  return null;
}

function projectOnPath(loc, edges) {
  let best = null;
  let chain = 0;
  for (const edge of edges) {
    const hit = pointSegDist(loc.e, loc.n, edge.ax, edge.ay, edge.bx, edge.by);
    if (!best || hit.d < best.d) best = { d: hit.d, at: chain + hit.t * edge.len };
    chain += edge.len;
  }
  return best;
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { d: Math.hypot(px - x, py - y), t };
}

function midsBetween(graph, locIndex, rail, a, b, used, tlk) {
  ensureCells(graph);
  const fromCands = snapCandidates(graph, a.e, a.n, b);
  const toCands = snapCandidates(graph, b.e, b.n, a);
  const straight = Math.hypot(a.e - b.e, a.n - b.n);
  const maxLen = straight * 1.8 + 400;
  let edges = null;
  // The node nearest the far end can be a dead-end spur. Keep trying snaps
  // until one of them connects within the direct-line budget.
  for (const from of fromCands) {
    for (const to of toCands) {
      const walkedEdges = route(graph, from.key, to.key, maxLen);
      if (!walkedEdges?.length) continue;
      edges = walkedEdges;
      break;
    }
    if (edges) break;
  }
  if (!edges?.length) return [];
  let chain = 0;
  const found = [];
  const seen = new Set();
  for (const edge of edges) {
    const x0 = Math.floor(Math.min(edge.ax, edge.bx) / CELL) - 1;
    const x1 = Math.floor(Math.max(edge.ax, edge.bx) / CELL) + 1;
    const y0 = Math.floor(Math.min(edge.ay, edge.by) / CELL) - 1;
    const y1 = Math.floor(Math.max(edge.ay, edge.by) / CELL) + 1;
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const loc of locIndex.grid.get(`${x},${y}`) || []) {
          if (used.has(loc.tiploc) || seen.has(loc.tiploc) || !keepLocation(loc)) continue;
          // A junction drawn on the map is not enough. Old layouts and junctions
          // that are not open yet sit on the same centreline. Only a current
          // timing tip, or a place the working timetable still links, is added.
          const timed = (tlk && tlkTips(tlk).has(loc.tiploc)) || rail.schedule.has(loc.tiploc);
          if (!timed) continue;
          const hit = pointSegDist(loc.e, loc.n, edge.ax, edge.ay, edge.bx, edge.by);
          if (hit.d > NEAR_M) continue;
          seen.add(loc.tiploc);
          found.push({ loc, at: chain + hit.t * edge.len, d: hit.d });
        }
      }
    }
    chain += edge.len;
  }
  found.sort((p, q) => p.at - q.at);
  const samePlace = (a, b) => samePlaceName(a.loc.name, b.loc.name);
  const kept = [];
  for (const point of found) {
    const prev = kept[kept.length - 1];
    // Distinct junctions a short way apart stay. Only a twin of the same
    // place (York Loop beside York Holgate) is dropped.
    if (prev && point.at - prev.at < 15 && samePlace(prev, point)) {
      if (point.d < prev.d) kept[kept.length - 1] = point;
      continue;
    }
    kept.push(point);
  }
  const seq = [a, ...kept.map((p) => p.loc), b];
  const weights = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const dist = Math.max(1, Math.hypot(seq[i].e - seq[i + 1].e, seq[i].n - seq[i + 1].n));
    weights.push(hopWeight(tlk, seq[i].tiploc, seq[i + 1].tiploc, graph.load, dist));
  }
  const sum = weights.reduce((total, w) => total + w, 0) || 1;
  let covered = 0;
  return kept.map((point, index) => {
    covered += weights[index];
    return { ...point, fraction: covered / sum };
  });
}

export function insertGtclPasses(calls, graph, catalog, timingLoad, tlkFile) {
  if (!graph || !catalog) return calls;
  graph.load = timingLoad || "";
  const tlk = loadTlk(tlkFile);
  const locIndex = locations(catalog);
  const rail = railLinks(catalog);
  const byTpl = new Map(locIndex.locs.map((l) => [l.tiploc, l]));
  const out = [];
  const used = new Set(calls.map((c) => String(c.tiploc || "").toUpperCase()));
  for (let i = 0; i < calls.length; i++) {
    out.push(calls[i]);
    if (i === calls.length - 1) break;
    const a = byTpl.get(String(calls[i].tiploc || "").toUpperCase());
    const b = byTpl.get(String(calls[i + 1].tiploc || "").toUpperCase());
    if (!a || !b) continue;
    // A report left before the origin must not walk the whole route backwards.
    // A normal gap, Leighton Buzzard to Bletchley is about 10 km, still fills.
    if (!isScheduleCall(calls[i]) && Math.hypot(a.e - b.e, a.n - b.n) > 30000) continue;
    const t0 = callClock(calls[i]);
    const t1 = callClock(calls[i + 1]);
    const live0 = calls[i].atp || calls[i].atd || calls[i].ata || calls[i].etp || calls[i].etd || calls[i].eta;
    const live1 = calls[i + 1].atp || calls[i + 1].atd || calls[i + 1].ata || calls[i + 1].etp || calls[i + 1].etd || calls[i + 1].eta;
    for (const mid of midsBetween(graph, locIndex, rail, a, b, used, tlk)) {
      used.add(mid.loc.tiploc);
      const wtp = clockAt(t0, t1, mid.fraction);
      // Booked clocks are shifted for lateness later. A gap that only has
      // live times already includes that lateness, so store the pass directly.
      const live = wtp ? null : clockAt(live0 || t0, live1 || t1, mid.fraction);
      const row = {
        tiploc: mid.loc.tiploc,
        crs: mid.loc.crs.length === 3 ? mid.loc.crs : null,
        name: mid.loc.name,
        is_passing: 1,
        wtp,
        atp: live,
        etp: wtp,
        live_kind: live ? "actual" : "est",
        actual_source: "inferred",
        platform: null,
      };
      out.push(row);
    }
  }
  return out;
}

/** Replace schedule-spine mileage with the distance along the finished list. */
export function assignTrackMiles(calls, graph, catalog) {
  const rows = (calls || []).map((c) => ({ ...c }));
  if (!rows.length || !catalog) return rows;
  const byTpl = new Map(locations(catalog).locs.map((l) => [l.tiploc, l]));
  if (graph) ensureCells(graph);
  let cum = 0;
  let last = 0;
  rows[0].leg_m = null;
  rows[0].cum_m = 0;
  for (let i = 1; i < rows.length; i++) {
    const b = byTpl.get(String(rows[i].tiploc || "").toUpperCase());
    if (!b) {
      rows[i].leg_m = null;
      rows[i].cum_m = cum;
      continue;
    }
    const a = byTpl.get(String(rows[last].tiploc || "").toUpperCase());
    let metres = null;
    if (a) {
      const straight = Math.hypot(a.e - b.e, a.n - b.n);
      if (graph) {
        const maxLen = straight * 1.8 + 400;
        const fromCands = snapCandidates(graph, a.e, a.n, b).slice(0, 3);
        const toCands = snapCandidates(graph, b.e, b.n, a).slice(0, 3);
        for (const from of fromCands) {
          for (const to of toCands) {
            const walked = route(graph, from.key, to.key, maxLen);
            if (!walked?.length) continue;
            metres = walked.reduce((sum, edge) => sum + edge.len, 0);
            break;
          }
          if (metres != null) break;
        }
      }
      if (metres == null) metres = straight;
    }
    rows[i].leg_m = metres;
    cum += metres || 0;
    rows[i].cum_m = cum;
    last = i;
  }
  return rows;
}

/**
 * Timetable calls stay in schedule order. A report with no booked time is
 * placed where it sits on the track between those calls, so the same rule
 * holds on every route.
 */
export function orderByTrack(calls, graph, locList) {
  const rows = (calls || []).map((c) => ({ ...c }));
  if (!graph || rows.length < 2) return rows;
  const byTpl = new Map((locList || []).map((loc) => [String(loc.tiploc || "").toUpperCase(), loc]));
  const anchorAt = [];
  rows.forEach((row, index) => {
    if (isScheduleCall(row)) anchorAt.push(index);
  });
  if (anchorAt.length < 2) return rows;
  const paths = [];
  for (let gap = 0; gap < anchorAt.length - 1; gap++) {
    const from = byTpl.get(String(rows[anchorAt[gap]].tiploc || "").toUpperCase());
    const to = byTpl.get(String(rows[anchorAt[gap + 1]].tiploc || "").toUpperCase());
    paths.push(from && to ? pathEdges(graph, from, to) : null);
  }
  const onRoute = anchorAt.slice(0, -1).map(() => []);
  const placed = new Set();
  for (let index = 0; index < rows.length; index++) {
    if (isScheduleCall(rows[index])) continue;
    const loc = byTpl.get(String(rows[index].tiploc || "").toUpperCase());
    if (!loc) continue;
    let best = null;
    for (let gap = 0; gap < paths.length; gap++) {
      if (!paths[gap]) continue;
      const hit = projectOnPath(loc, paths[gap]);
      if (!hit || hit.d > ROUTE_OFF_M) continue;
      if (!best || hit.d < best.d) best = { gap, at: hit.at, index };
    }
    if (!best) continue;
    onRoute[best.gap].push(best);
    placed.add(index);
  }
  const lead = [];
  const unmatched = anchorAt.slice(0, -1).map(() => []);
  const tail = [];
  for (let index = 0; index < rows.length; index++) {
    if (isScheduleCall(rows[index]) || placed.has(index)) continue;
    let gap = -1;
    for (let anchor = 0; anchor < anchorAt.length; anchor++) {
      if (anchorAt[anchor] < index) gap = anchor;
      else break;
    }
    if (gap < 0) lead.push(rows[index]);
    else if (gap >= anchorAt.length - 1) tail.push(rows[index]);
    else unmatched[gap].push(rows[index]);
  }
  const out = [...lead];
  for (let gap = 0; gap < anchorAt.length; gap++) {
    out.push(rows[anchorAt[gap]]);
    if (gap >= anchorAt.length - 1) continue;
    onRoute[gap].sort((a, b) => a.at - b.at || a.index - b.index);
    for (const hit of onRoute[gap]) out.push(rows[hit.index]);
    out.push(...unmatched[gap]);
  }
  out.push(...tail);
  return out;
}

export function orderCallsAlongTrack(calls, graph, catalog) {
  if (!graph || !catalog) return (calls || []).map((c) => ({ ...c }));
  return orderByTrack(calls, graph, locations(catalog).locs);
}

const CLOSE_M = 120;
// A named side plotted on the wrong side of the same place, up to about a kilometre.
const SIDE_M = 1100;

function compassSide(name) {
  const text = String(name || "");
  const long = text.match(/\b(north|south|east|west)\b/i);
  if (long) return long[1].toLowerCase();
  const short = text.match(/\b([nsew])\.?\s*(?:jn|jcn|junction)\b/i);
  if (!short) return null;
  return { n: "north", s: "south", e: "east", w: "west" }[short[1].toLowerCase()];
}

function sideAxis(side) {
  if (side === "north" || side === "south") return "ns";
  if (side === "east" || side === "west") return "ew";
  return null;
}

/** 0 is reached first. A place with no side sits in the middle. */
function sideRank(side, towardPositive) {
  if (!side) return 1;
  const positive = side === "north" || side === "east";
  return towardPositive === positive ? 2 : 0;
}

function coordinated(rows, byTpl, index) {
  const row = rows[index];
  if (!row) return null;
  return byTpl.get(String(row.tiploc || "").toUpperCase()) || null;
}

function travelPast(rows, byTpl, index) {
  let before = null;
  for (let j = index - 2; j >= 0; j--) {
    const loc = coordinated(rows, byTpl, j);
    if (!loc) continue;
    const here = coordinated(rows, byTpl, index - 1);
    if (here && Math.hypot(loc.e - here.e, loc.n - here.n) < 200) continue;
    before = loc;
    break;
  }
  let after = null;
  for (let j = index + 1; j < rows.length; j++) {
    const loc = coordinated(rows, byTpl, j);
    if (!loc) continue;
    const here = coordinated(rows, byTpl, index);
    if (here && Math.hypot(loc.e - here.e, loc.n - here.n) < 200) continue;
    after = loc;
    break;
  }
  if (!before || !after) return null;
  return { dx: after.e - before.e, dy: after.n - before.n };
}

function plottedOnWrongSide(side, point, other) {
  if (side === "east") return point.e < other.e - 50;
  if (side === "west") return point.e > other.e + 50;
  if (side === "north") return point.n < other.n - 50;
  if (side === "south") return point.n > other.n + 50;
  return false;
}

function closePairBackwards(rows, byTpl, index) {
  const a = coordinated(rows, byTpl, index - 1);
  const b = coordinated(rows, byTpl, index);
  if (!a || !b) return false;
  const dist = Math.hypot(a.e - b.e, a.n - b.n);
  if (dist > SIDE_M) return false;
  if (!samePlaceName(a.name, b.name)) return false;
  const sideA = compassSide(a.name);
  const sideB = compassSide(b.name);
  const axis = sideAxis(sideA) || sideAxis(sideB);
  if (!axis || (sideA && sideB && sideAxis(sideA) !== sideAxis(sideB))) return false;
  if (dist > CLOSE_M) {
    const wrong =
      (sideA && plottedOnWrongSide(sideA, a, b)) || (sideB && plottedOnWrongSide(sideB, b, a));
    // A kilometre is enough to fix Margam East plotted west of Margam Middle.
    // It is not enough to pull Bletchley South back past Drayton Road: that
    // second name is a different junction, not the middle of the same place.
    const centre = (name) => {
      const words = placeWords(name);
      words.delete("middle");
      return [...words].sort().join(" ");
    };
    if (!wrong || centre(a.name) !== centre(b.name)) return false;
  }
  const travel = travelPast(rows, byTpl, index);
  if (!travel) return false;
  const delta = axis === "ns" ? travel.dy : travel.dx;
  if (Math.abs(delta) < 200) return false;
  return sideRank(sideA, delta > 0) > sideRank(sideB, delta > 0);
}

/**
 * Coordinates closer than about 120 m are inside survey noise. The named
 * side then follows the direction of the train, which is the order Realtime
 * Trains keeps.
 */
export function orderClosePlaces(calls, locList) {
  const rows = (calls || []).map((c) => ({ ...c }));
  const byTpl = new Map((locList || []).map((loc) => [String(loc.tiploc || "").toUpperCase(), loc]));
  let moved = true;
  for (let guard = 0; moved && guard < rows.length; guard++) {
    moved = false;
    for (let index = 1; index < rows.length; index++) {
      if (!closePairBackwards(rows, byTpl, index)) continue;
      const swap = rows[index - 1];
      rows[index - 1] = rows[index];
      rows[index] = swap;
      moved = true;
    }
  }
  return rows;
}

export function orderCloseCallingPlaces(calls, catalog) {
  if (!catalog) return (calls || []).map((c) => ({ ...c }));
  return orderClosePlaces(calls, locations(catalog).locs);
}
