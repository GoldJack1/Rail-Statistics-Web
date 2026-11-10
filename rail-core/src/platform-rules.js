/**
 * Manual map tweaks, read from disk so a VPS edit applies without a site deploy
 * and without restarting the query process.
 *
 * config/platform-rules.json chooses the platform a service is routed through.
 * config/platform-fixes.json places a platform number on a measured rail.
 * PLATFORM_RULES_PATH and PLATFORM_FIXES_PATH override those locations.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.PLATFORM_RULES_PATH || join(HERE, "../config/platform-rules.json");
const FIXES_PATH = process.env.PLATFORM_FIXES_PATH || join(HERE, "../config/platform-fixes.json");

const cache = new Map();

function readJson(path) {
  const stamp = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.stamp === stamp) return hit.body;
  const body = JSON.parse(readFileSync(path, "utf8"));
  cache.set(path, { stamp, body });
  return body;
}

/** `{ rules }` from the rules file, or null when the file is missing or unreadable. */
export function readPlatformRules() {
  try {
    const body = readJson(RULES_PATH);
    return Array.isArray(body?.rules) ? body : null;
  } catch {
    return null;
  }
}

function readPlatformFixes() {
  try {
    const body = readJson(FIXES_PATH);
    return {
      stands: Array.isArray(body?.stands) ? body.stands : [],
      stations: Array.isArray(body?.stations) ? body.stations : [],
    };
  } catch {
    return { stands: [], stations: [] };
  }
}

function refOf(value) {
  return String(value || "").trim().toUpperCase();
}

function metres(aLat, aLng, bLat, bLng) {
  const lat = ((aLat + bLat) / 2) * (Math.PI / 180);
  const dy = (bLat - aLat) * 111_320;
  const dx = (bLng - aLng) * 111_320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

function standAt(fix) {
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  return {
    lat,
    lng,
    ends: [[lat, lng], [lat, lng]],
    stand: [lat, lng],
  };
}

function withinStation(request, near, withinM) {
  if (!Array.isArray(near) || near.length < 2) return false;
  const within = Number(withinM) > 0 ? Number(withinM) : 500;
  return metres(request.lat, request.lng, Number(near[0]), Number(near[1])) <= within;
}

/**
 * A stand replaces the quai position for that platform number at a nearby
 * station. `withinM` defaults to 500. The request platform `*` writes
 * `id~ref`. A station block can drop quai's old numbers and send a booking
 * such as 4 to another platform's measured rail.
 */
export function applyPlatformFixes(coords, requests) {
  const { stands, stations } = readPlatformFixes();
  if (!coords) return coords;
  for (const fix of stands) {
    const ref = refOf(fix.ref);
    if (!ref || !Number.isFinite(Number(fix.lat)) || !Number.isFinite(Number(fix.lng))) continue;
    for (const request of requests) {
      if (!withinStation(request, fix.near, fix.withinM)) continue;
      const asked = refOf(request.platform);
      if (asked !== "*" && asked !== ref) continue;
      const place = standAt(fix);
      if (asked === "*") coords[`${request.id}~${ref}`] = place;
      else coords[request.id] = place;
    }
  }
  for (const station of stations) {
    const drop = new Set((station.drop || []).map(refOf));
    const alias = new Map(Object.entries(station.alias || {}).map(([from, to]) => [refOf(from), refOf(to)]));
    const placed = new Map();
    for (const stand of station.stands || []) {
      const ref = refOf(stand.ref);
      if (!ref || !Number.isFinite(Number(stand.lat)) || !Number.isFinite(Number(stand.lng))) continue;
      placed.set(ref, standAt(stand));
    }
    for (const request of requests) {
      if (!withinStation(request, station.near, station.withinM)) continue;
      const asked = refOf(request.platform);
      if (asked === "*") {
        for (const key of Object.keys(coords)) {
          const prefix = `${request.id}~`;
          if (key.startsWith(prefix) && drop.has(key.slice(prefix.length))) delete coords[key];
        }
        for (const [ref, place] of placed) coords[`${request.id}~${ref}`] = place;
        continue;
      }
      const ref = alias.get(asked) || asked;
      const place = placed.get(ref);
      if (place && (placed.has(asked) || alias.has(asked))) coords[request.id] = place;
    }
  }
  return coords;
}
