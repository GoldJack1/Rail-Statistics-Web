/**
 * Platforms worked out for stations quai has none for, read from
 * config/platform-derived.json (scripts/derive-platforms.js writes it). Read
 * from disk and kept until the file changes, so a regenerated file applies
 * without a restart. PLATFORM_DERIVED_PATH overrides the location.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = process.env.PLATFORM_DERIVED_PATH || join(HERE, "../config/platform-derived.json");
/** A station's pin and the lookup point can sit this far apart. */
const WITHIN_M = 300;

let cached = null;

function metres(aLat, aLng, bLat, bLng) {
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot((bLat - aLat) * 110_540, (bLng - aLng) * 111_320 * Math.cos(lat));
}

function readStations() {
  try {
    const stamp = statSync(PATH).mtimeMs;
    if (cached && cached.stamp === stamp) return cached.stations;
    const body = JSON.parse(readFileSync(PATH, "utf8"));
    cached = { stamp, stations: Array.isArray(body?.stations) ? body.stations : [] };
    return cached.stations;
  } catch {
    return [];
  }
}

/** The derived platforms of the station nearest `lat`, `lng`, as quai writes tracks. Null when there are none. */
export function derivedTracksAt(lat, lng, stations = readStations()) {
  let best = null;
  let bestAway = WITHIN_M;
  for (const station of stations) {
    const away = metres(lat, lng, station.lat, station.lng);
    if (away <= bestAway) {
      best = station;
      bestAway = away;
    }
  }
  if (!best || !Array.isArray(best.tracks) || best.tracks.length === 0) return null;
  return best.tracks.map((track) => ({ ref: track.ref, lat: track.lat, lng: track.lng, on_track: true }));
}
