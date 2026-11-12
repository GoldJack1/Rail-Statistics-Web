#!/usr/bin/env node
/**
 * Writes config/platform-derived.json: platform positions for the stations
 * quai has no numbered platforms for, from the track and the direction the
 * booked trains run (src/derive-platforms.js).
 *
 *   node scripts/derive-platforms.js --stations stations.json
 *   node scripts/derive-platforms.js --stations stations.json --validate
 *
 * `--stations` is the station list: the site's stations_gbnr export, or rows of
 * `[crs, name, lat, lng]`. `--validate` runs the same on stations quai does
 * have platforms for and reports how often the two agree, writing nothing.
 * `--days` is how many days of calls to read (14).
 */
import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { derivePlatforms, localFrame } from "../src/derive-platforms.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(HERE, "../data");
const QUAI_URL = String(process.env.QUAI_URL || "http://127.0.0.1:5020").replace(/\/$/, "");
const OUT = process.env.PLATFORM_DERIVED_PATH || join(HERE, "../config/platform-derived.json");
/** A neighbour this far off gives the direction of travel. */
/** Fewer stations than this is a failed run. */
const MIN_STATIONS = 100;
const FAR_M = Number(process.env.FAR_M || 600);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

function metres(a, b) {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return Math.hypot((b.lat - a.lat) * 110_540, (b.lng - a.lng) * 111_320 * Math.cos(lat));
}

function readStations(path) {
  const rows = JSON.parse(readFileSync(path, "utf8"));
  return rows
    .map((row) => (Array.isArray(row)
      ? { crs: row[0], name: row[1], lat: Number(row[2]), lng: Number(row[3]) }
      : { crs: row.crsCode, name: row.stationName, lat: Number(row.latitude), lng: Number(row.longitude) }))
    .filter((s) => s.crs && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

function railIndex() {
  const { lines } = JSON.parse(readFileSync(join(DATA_DIR, "gb-passenger-rail.json"), "utf8"));
  const cells = new Map();
  lines.forEach((line, i) => {
    for (const [lng, lat] of line) {
      const key = `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
      let set = cells.get(key);
      if (!set) cells.set(key, (set = new Set()));
      set.add(i);
    }
  });
  return {
    near(lat, lng) {
      const found = new Set();
      const cy = Math.floor(lat * 100);
      const cx = Math.floor(lng * 100);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const i of cells.get(`${cy + dy},${cx + dx}`) ?? []) found.add(i);
      return [...found].map((i) => lines[i]);
    },
  };
}

async function quaiTracks(station) {
  const url = `${QUAI_URL}/reverse?lat=${station.lat}&lon=${station.lng}&mode=train&radius=0.5&limit=1`;
  try {
    const body = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
    const tracks = body?.stations?.[0]?.tracks;
    return Array.isArray(tracks) ? tracks.filter((t) => String(t.ref || "").trim()) : [];
  } catch {
    return null;
  }
}

function catalogMaps() {
  const db = new DatabaseSync(join(DATA_DIR, "catalog.sqlite"), { readOnly: true });
  const geo = new Map(db.prepare("SELECT tiploc, lat, lon FROM tiploc_geo").all().map((r) => [r.tiploc, { lat: r.lat, lng: r.lon }]));
  const byCrs = new Map();
  for (const row of db.prepare("SELECT tiploc, crs FROM tiploc WHERE crs IS NOT NULL AND crs != ''").all()) {
    (byCrs.get(row.crs) ?? byCrs.set(row.crs, []).get(row.crs)).push(row.tiploc);
  }
  db.close();
  return { geo, byCrs };
}

function recentDays(count) {
  const today = new Date().toISOString().slice(0, 10);
  return readdirSync(DATA_DIR)
    .map((name) => /^day-(\d{4}-\d{2}-\d{2})\.sqlite$/.exec(name))
    .filter((m) => m && m[1] < today)
    .map((m) => m[1])
    .sort()
    .slice(-count);
}

/** Every booked call at the given tiplocs, with the far-off places before and after it. */
function bookedCalls(days, tiplocToStation, geo) {
  const calls = new Map();
  const tiplocs = [...tiplocToStation.keys()];
  for (const day of days) {
    const db = new DatabaseSync(join(DATA_DIR, `day-${day}.sqlite`), { readOnly: true });
    const rids = new Set();
    const hits = [];
    for (let i = 0; i < tiplocs.length; i += 400) {
      const chunk = tiplocs.slice(i, i + 400);
      const marks = chunk.map(() => "?").join(",");
      for (const row of db.prepare(
        `SELECT rid, seq, tiploc, platform FROM calls WHERE tiploc IN (${marks}) AND platform IS NOT NULL AND platform != '' AND cancelled = 0`,
      ).all(...chunk)) {
        hits.push(row);
        rids.add(row.rid);
      }
    }
    const route = new Map();
    const ridList = [...rids];
    for (let i = 0; i < ridList.length; i += 800) {
      const chunk = ridList.slice(i, i + 800);
      const marks = chunk.map(() => "?").join(",");
      for (const row of db.prepare(`SELECT rid, seq, tiploc FROM calls WHERE rid IN (${marks}) ORDER BY rid, seq`).all(...chunk)) {
        (route.get(row.rid) ?? route.set(row.rid, []).get(row.rid)).push(row);
      }
    }
    db.close();
    for (const hit of hits) {
      const station = tiplocToStation.get(hit.tiploc);
      const here = geo.get(hit.tiploc);
      const stops = route.get(hit.rid);
      if (!station || !here || !stops) continue;
      const at = stops.findIndex((row) => row.seq === hit.seq);
      const far = (from, step) => {
        for (let i = from; i >= 0 && i < stops.length; i += step) {
          const place = geo.get(stops[i].tiploc);
          if (place && metres(here, place) >= FAR_M) return place;
        }
        return null;
      };
      const prev = far(at - 1, -1);
      const next = far(at + 1, 1);
      if (!prev || !next) continue;
      (calls.get(station.crs) ?? calls.set(station.crs, []).get(station.crs)).push({ ref: hit.platform, prev, next });
    }
  }
  return calls;
}

async function mapLimit(items, limit, work) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i]);
    }
  }));
  return out;
}

async function main() {
  const stationsPath = value("stations");
  if (!stationsPath) throw new Error("--stations is required");
  const validate = flag("validate");
  const stations = readStations(stationsPath);
  console.log(`${stations.length} stations`);
  const quai = await mapLimit(stations, 8, quaiTracks);
  // Validation is on the kind of station that is derived: one or two platforms.
  const small = (tracks) => new Set(tracks.map((t) => String(t.ref).trim().toUpperCase())).size <= 2;
  const targets = stations.filter((_, i) => (validate ? (quai[i]?.length ?? 0) > 0 && small(quai[i]) : quai[i] !== null && quai[i].length === 0));
  const quaiBy = new Map(stations.map((s, i) => [s.crs, quai[i]]));
  console.log(`${targets.length} stations ${validate ? "with" : "without"} quai platforms${validate ? " (one or two)" : ""}`);

  const { geo, byCrs } = catalogMaps();
  const tiplocToStation = new Map();
  for (const station of targets) for (const tiploc of byCrs.get(station.crs) ?? []) tiplocToStation.set(tiploc, station);
  const days = recentDays(Number(value("days", 14)));
  console.log(`reading ${days.length} days: ${days[0]} to ${days[days.length - 1]}`);
  const calls = bookedCalls(days, tiplocToStation, geo);
  const rail = railIndex();

  const derived = [];
  const reasons = new Map();
  const wrongList = [];
  const byGap = {};
  const agreement = { compared: 0, right: 0, wrong: 0, islandOrSame: 0 };
  const only = value("only", "").split(",").filter(Boolean);
  for (const station of only.length ? targets.filter((t) => only.includes(t.crs)) : targets) {
    const result = derivePlatforms({ pin: station, lines: rail.near(station.lat, station.lng), calls: calls.get(station.crs) ?? [] });
    if (only.length) console.log(station.crs, JSON.stringify({ derived: result.tracks, skipped: result.skipped, axis: result.axis, trackCount: result.trackCount, refs: result.refs, offsets: result.offsets, quai: quaiBy.get(station.crs)?.map((t) => [t.ref, t.lat, t.lng]), calls: (calls.get(station.crs) ?? []).length }));
    for (const skip of result.skipped) reasons.set(skip.reason, (reasons.get(skip.reason) ?? 0) + 1);
    if (result.tracks.length === 0) continue;
    if (validate) {
      const truth = (quaiBy.get(station.crs) ?? []).map((t) => ({ ref: String(t.ref).trim().toUpperCase(), lat: t.lat, lng: t.lng }));
      // The platforms sit at the pin's along-track position, not the platform's, so they are
      // judged by which side of each other they are across the line of travel.
      const left = { x: -result.axis.y, y: result.axis.x };
      const frame = localFrame(station.lat, station.lng);
      const across = (p) => { const q = frame.toXY(p.lat, p.lng); return q.x * left.x + q.y * left.y; };
      // Judged across the line of travel: does each derived platform sit nearer, across the
      // track, to its own quai platform than to the other one?
      if (result.trackCount < 2 || result.tracks.length < 2) continue;
      const real = result.tracks.map((t) => truth.find((r) => r.ref === t.ref));
      if (real.some((r) => !r) || Math.abs(across(real[0]) - across(real[1])) < 3) { agreement.islandOrSame += 1; continue; }
      agreement.compared += 1;
      let right = 0;
      result.tracks.forEach((t, i) => {
        const own = Math.abs(across(t) - across(real[i]));
        const other = Math.abs(across(t) - across(real[1 - i]));
        if (own < other) right += 1;
      });
      const gap = Math.abs(result.offsets[1] - result.offsets[0]);
      const bucket = gap < 3.5 ? "gap<3.5" : gap < 5 ? "gap3.5-5" : gap < 8 ? "gap5-8" : "gap8+";
      byGap[bucket] ??= { right: 0, wrong: 0 };
      byGap[bucket][right === 2 ? "right" : "wrong"] += 1;
      if (right === 2) agreement.right += 1;
      else { agreement.wrong += 1; wrongList.push(station.crs); }
    } else {
      derived.push({
        crs: station.crs,
        name: station.name,
        lat: station.lat,
        lng: station.lng,
        tracks: result.tracks.map((t) => ({ ref: t.ref, lat: Number(t.lat.toFixed(6)), lng: Number(t.lng.toFixed(6)) })),
      });
    }
  }
  console.log("left out:", Object.fromEntries(reasons));
  if (validate) {
    console.log("two-platform stations compared with quai (which side each platform is on):", agreement.compared);
    console.log(agreement);
    console.log("by track spacing:", JSON.stringify(byGap));
    console.log("some wrong:", wrongList.slice(0, 12).join(","));
    return;
  }
  // A run that found next to nothing (quai down, no history) must not wipe a good file.
  if (derived.length < MIN_STATIONS) throw new Error(`only ${derived.length} stations derived, keeping the existing file`);
  writeFileSync(`${OUT}.tmp`, JSON.stringify({ generatedAt: new Date().toISOString(), days: days.length, stations: derived }, null, 1));
  renameSync(`${OUT}.tmp`, OUT);
  console.log(`${derived.length} stations, ${derived.reduce((n, s) => n + s.tracks.length, 0)} platforms -> ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
