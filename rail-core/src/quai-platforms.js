/**
 * Platform positions for the service map, from quai (the station index built
 * from OpenStreetMap, run beside this server). One lookup per station, kept a
 * day. Platform numbers are matched by quai-platforms-core.js, shared with the site.
 */
import { lookupQuaiPlatforms, parsePlatformQuery } from "./quai-platforms-core.js";
import { applyPlatformFixes } from "./platform-rules.js";
import { chooseLeftHandRoads, roadRequests } from "./left-hand-road.js";

const QUAI_URL = String(process.env.QUAI_URL || "http://127.0.0.1:5020").replace(/\/$/, "");
const STATION_MS = 24 * 60 * 60 * 1000;
const MISS_MS = 60 * 1000;
const RADIUS_KM = 0.5;

const stations = new Map();

function stationKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function fetchStationTracks(lat, lng) {
  const url = new URL(`${QUAI_URL}/reverse`);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("mode", "train");
  url.searchParams.set("radius", String(RADIUS_KM));
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
  if (!response.ok) throw new Error(`quai ${response.status}`);
  const station = (await response.json())?.stations?.[0];
  return Array.isArray(station?.tracks) ? station.tracks : [];
}

/** The tracks of the station at a point. Null when quai cannot be reached. */
async function stationTracks(lat, lng) {
  const key = stationKey(lat, lng);
  const hit = stations.get(key);
  if (hit && Date.now() < hit.until) return hit.tracks;
  try {
    const tracks = await fetchStationTracks(lat, lng);
    stations.set(key, { tracks, until: Date.now() + STATION_MS });
    return tracks;
  } catch (error) {
    console.warn("quai platforms", error instanceof Error ? error.message : error);
    stations.set(key, { tracks: null, until: Date.now() + MISS_MS });
    return null;
  }
}

/**
 * Platforms for a list of `{ id, lat, lng, platform }` requests. `*` is every
 * platform, `left@<bearing>` the left-hand road of a call with no booked platform.
 */
export async function platformCoordsFor(requests) {
  if (requests.length === 0) return {};
  const asked = roadRequests(requests);
  const coords = applyPlatformFixes(await lookupQuaiPlatforms(asked, stationTracks), asked);
  return chooseLeftHandRoads(coords, requests);
}

/** `at` as the site sends it: `id~lat~lng~platform|…`, at most 40 stops. */
export async function platformCoords(at) {
  return platformCoordsFor(parsePlatformQuery(at || ""));
}
