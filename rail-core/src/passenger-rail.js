/**
 * Journey lines for the service map. The graph is built once and kept in
 * memory. A missing link that sends the train backwards is asked of the
 * public rail router instead.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RAIL_GRAPH_REVISION,
  buildRailGraph,
  linesFromNetwork,
  routeOnGraph,
} from "./passenger-rail-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const OPEN_RAIL = "https://routing.openrailrouting.org/route";
const SHARP_TURN = (22 * Math.PI) / 180;
const FILLET_M = 110;

let graph = null;
let loading = null;
const journeyCache = new Map();

export function passengerRailRevision() {
  return RAIL_GRAPH_REVISION;
}

export function passengerRailFile() {
  const fromEnv = String(process.env.PASSENGER_RAIL_JSON || "").trim();
  const dataDir = process.env.DATA_DIR || join(here, "../data");
  const candidates = [
    fromEnv,
    join(dataDir, "gb-passenger-rail.json"),
    join(here, "../../new-site/public/data/gb-passenger-rail.json"),
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) || null;
}

export function ensurePassengerRail() {
  if (graph) return Promise.resolve(graph);
  if (!loading) {
    loading = Promise.resolve()
      .then(() => {
        const file = passengerRailFile();
        if (!file) {
          console.warn("passenger rail file not found");
          return null;
        }
        const lines = linesFromNetwork(JSON.parse(readFileSync(file, "utf8")));
        if (lines.length < 1) return null;
        graph = buildRailGraph(lines);
        console.log(`passenger rail ${lines.length} lines from ${file}`);
        return graph;
      })
      .catch((error) => {
        loading = null;
        console.error("passenger rail", error);
        return null;
      });
  }
  return loading;
}

function metresBetween(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dy = (b[0] - a[0]) * 111_320;
  const dx = (b[1] - a[1]) * 111_320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

/** A gap makes the shortest path leave away from the next point and return the long way. */
export function graphLegGoesBackwards(path, from, to) {
  if (path.length < 2) return false;
  const goal = metresBetween(from, to);
  if (goal < 4_000) return false;
  let along = 0;
  let closest = goal;
  const limit = Math.min(3_000, goal);
  for (let i = 1; i < path.length; i++) {
    along += metresBetween(path[i - 1], path[i]);
    const remain = metresBetween(path[i], to);
    if (remain < closest) closest = remain;
    if (along >= limit) break;
  }
  if (closest < goal - 800) return false;
  let rail = 0;
  for (let i = 1; i < path.length; i++) rail += metresBetween(path[i - 1], path[i]);
  return rail > goal * 2.2 && rail - goal > 8_000;
}

function roundSharpCorners(path) {
  if (path.length < 3) return path;
  const cuts = new Array(path.length).fill(0);
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const here = path[i];
    const next = path[i + 1];
    const d1 = metresBetween(prev, here);
    const d2 = metresBetween(here, next);
    if (d1 < 12 || d2 < 12) continue;
    const lat = (here[0] * Math.PI) / 180;
    const v1x = (here[1] - prev[1]) * Math.cos(lat);
    const v1y = here[0] - prev[0];
    const v2x = (next[1] - here[1]) * Math.cos(lat);
    const v2y = next[0] - here[0];
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 === 0 || n2 === 0) continue;
    const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
    if (Math.acos(cos) < SHARP_TURN) continue;
    cuts[i] = Math.min(FILLET_M, d1 * 0.45, d2 * 0.45);
  }
  for (let i = 1; i < path.length - 1; i++) {
    const room = metresBetween(path[i], path[i + 1]) * 0.45;
    const share = cuts[i] + cuts[i + 1];
    if (share > room && share > 0) {
      cuts[i] *= room / share;
      cuts[i + 1] *= room / share;
    }
  }
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const cut = cuts[i];
    const here = path[i];
    if (cut < 18) {
      out.push(here);
      continue;
    }
    const prev = path[i - 1];
    const next = path[i + 1];
    const d1 = metresBetween(prev, here);
    const d2 = metresBetween(here, next);
    const t1 = cut / d1;
    const t2 = cut / d2;
    const p1 = [here[0] + (prev[0] - here[0]) * t1, here[1] + (prev[1] - here[1]) * t1];
    const p2 = [here[0] + (next[0] - here[0]) * t2, here[1] + (next[1] - here[1]) * t2];
    out.push(p1);
    for (let step = 1; step <= 4; step++) {
      const t = step / 5;
      const u = 1 - t;
      out.push([
        u * u * p1[0] + 2 * u * t * here[0] + t * t * p2[0],
        u * u * p1[1] + 2 * u * t * here[1] + t * t * p2[1],
      ]);
    }
    out.push(p2);
  }
  out.push(path[path.length - 1]);
  return out;
}

function haversineM(a, b) {
  const R = 6371000;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function removeRouteReversals(path, keepNear) {
  const closeM = 40;
  const minLoopM = 70;
  const maxLoopM = 8000;
  const loopStillServesStops = (pts, from, to) => {
    if (!keepNear?.length) return true;
    for (const stop of keepNear) {
      let onLoop = false;
      for (let k = from + 1; k < to; k++) {
        if (haversineM(stop, pts[k]) <= closeM) {
          onLoop = true;
          break;
        }
      }
      if (!onLoop) continue;
      let onKept = haversineM(stop, pts[from]) <= 80 || haversineM(stop, pts[to]) <= 80;
      for (let k = 0; k < pts.length && !onKept; k++) {
        if (k > from && k < to) continue;
        if (haversineM(stop, pts[k]) <= 80) onKept = true;
      }
      if (!onKept) return false;
    }
    return true;
  };
  let pts = path;
  for (let pass = 0; pass < 8; pass++) {
    if (pts.length < 4) break;
    const drop = new Array(pts.length).fill(false);
    let changed = false;
    let i = 0;
    while (i < pts.length) {
      let walked = 0;
      let cut = -1;
      for (let j = i + 1; j < pts.length; j++) {
        walked += haversineM(pts[j - 1], pts[j]);
        if (walked > maxLoopM) break;
        if (j >= i + 2 && walked >= minLoopM && haversineM(pts[i], pts[j]) <= closeM && loopStillServesStops(pts, i, j)) {
          cut = j;
        }
      }
      if (cut > i) {
        for (let k = i + 1; k < cut; k++) drop[k] = true;
        changed = true;
        i = cut;
      } else {
        i += 1;
      }
    }
    if (!changed) break;
    const next = pts.filter((_, index) => !drop[index]);
    if (next.length < 2 || next.length === pts.length) break;
    pts = next;
  }
  return pts;
}

async function openRailLeg(from, to) {
  const url = new URL(OPEN_RAIL);
  url.searchParams.append("point", `${from[0]},${from[1]}`);
  url.searchParams.append("point", `${to[0]},${to[1]}`);
  url.searchParams.set("profile", "non_tgv");
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("instructions", "false");
  url.searchParams.set("elevation", "false");
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const payload = await response.json();
  const coordinates = payload?.paths?.[0]?.points?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const path = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    path.push([lat, lng]);
  }
  return path;
}

function cacheKey(points) {
  return points.map((point) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`).join("|");
}

/**
 * One polyline per connected stretch. A gap between stretches is a separate
 * segment, because JSON cannot carry the gap marker the browser uses.
 */
export async function routePassengerJourney(points) {
  const ready = await ensurePassengerRail();
  if (!ready || points.length < 2) return [];
  const key = cacheKey(points);
  const hit = journeyCache.get(key);
  if (hit) return hit;
  const segments = [];
  let current = [];
  const breakSegment = () => {
    if (current.length >= 2) segments.push(current);
    current = [];
  };
  const append = (leg) => {
    if (!leg || leg.length < 2) {
      breakSegment();
      return;
    }
    if (current.length === 0) current.push(...leg);
    else current.push(...leg.slice(1));
  };
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    let leg = routeOnGraph(ready, { lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] });
    if (leg && graphLegGoesBackwards(leg, from, to)) leg = null;
    if (!leg) {
      try {
        leg = await openRailLeg(from, to);
      } catch {
        leg = null;
      }
    }
    append(leg);
  }
  breakSegment();
  const drawn = segments
    .map((segment) => roundSharpCorners(removeRouteReversals(segment, points)))
    .filter((segment) => segment.length >= 2);
  if (journeyCache.size > 200) journeyCache.clear();
  journeyCache.set(key, drawn);
  return drawn;
}
