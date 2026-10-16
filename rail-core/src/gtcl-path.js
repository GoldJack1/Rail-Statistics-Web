/**
 * Passes the timetable does not book, compiled the way Railfeed describes it.
 * Schedule neighbours come first. A place is kept only when it also lies on
 * the GTCL path and has at least two rail neighbours. The clock is the booked
 * running time split by distance along that path.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { callClock } from "./tiploc-graph.js";

const NEAR_M = 40;
const SCHEDULE_M = 70;
const SNAP_M = 80;
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

function loadLocations(catalog) {
  const rows = catalog
    .prepare(
      `SELECT g.tiploc, g.easting AS e, g.northing AS n, t.name, t.crs
       FROM tiploc_geo g
       LEFT JOIN tiploc t ON t.tiploc = g.tiploc
       WHERE g.easting IS NOT NULL AND g.northing IS NOT NULL`,
    )
    .all();
  const grid = new Map();
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
    const k = `${Math.floor(loc.e / CELL)},${Math.floor(loc.n / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(loc);
    else grid.set(k, [loc]);
  }
  return { locs, grid };
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

function route(graph, fromKey, toKey) {
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
    for (const edge of graph.adj.get(key) || []) {
      const next = `${edge.ax},${edge.ay}` === key ? `${edge.bx},${edge.by}` : `${edge.ax},${edge.ay}`;
      const nd = d + edge.len;
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
  let edges = null;
  // The node nearest the far end can be a dead-end spur. Keep trying snaps
  // until one of them actually connects.
  for (const from of fromCands) {
    for (const to of toCands) {
      const walkedEdges = route(graph, from.key, to.key);
      if (!walkedEdges?.length) continue;
      const walked = walkedEdges.reduce((sum, edge) => sum + edge.len, 0);
      if (walked > straight * 1.8 + 400) continue;
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
          const neighbours = rail.nbr.get(loc.tiploc);
          if (!neighbours || neighbours.size < 2) continue;
          if (tlk && !tlkTips(tlk).has(loc.tiploc)) continue;
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
  const placeWords = (name) =>
    new Set(
      String(name || "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 4 && !/junction|north|south|east|west|loop|crossover/.test(w)),
    );
  const samePlace = (a, b) => {
    const words = placeWords(a.loc.name);
    for (const w of placeWords(b.loc.name)) if (words.has(w)) return true;
    return false;
  };
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
      out.push({
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
      });
    }
  }
  return out;
}
