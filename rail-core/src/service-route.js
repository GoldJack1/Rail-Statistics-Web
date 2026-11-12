/**
 * The rail-map line for one service, for the website and the iOS app.
 *
 * `POST /api/service-route` takes the timing points a client has placed on
 * the map and answers with the line, the platform each point is routed
 * through and where each marker sits. Every routing decision is made here:
 * the platform rules, the road through a station with no booked platform,
 * which points the route is asked to pass, and the correction when a point
 * turns out to be on the wrong track. A client only draws the answer, so a
 * routing fix does not need a site build or an app release.
 *
 * The track geometry between the chosen points comes from the rail-route
 * service (`RAIL_ROUTE_URL`).
 */
import { platformCoordsFor } from "./quai-platforms.js";
import { readPlatformRules } from "./platform-rules.js";

const QUERY_READ_ONLY = /^(1|true|yes)$/i.test(String(process.env.QUERY_READ_ONLY || "").trim());
const QUERY_ENV = String(process.env.QUERY_ENV || (QUERY_READ_ONLY ? "dev" : "live")).trim().toLowerCase();
const RAIL_ROUTE_URL = String(
  process.env.RAIL_ROUTE_URL
    || (QUERY_ENV === "dev"
      ? "https://beta.railstatistics.co.uk/api/rail-route"
      : "https://railstatistics.co.uk/api/rail-route"),
);
/** Bumps every cache when the rail line is laid differently. */
export const RAIL_ROUTE_REV = "25";
const ROUTE_CACHE_MS = 30 * 60 * 1000;
const ROUTE_CACHE_MAX = 400;
const MAX_STOPS = 400;
/** A platform further than this from its station pin belongs to another station. */
const PLATFORM_APPLY_M = 800;

// ---------------------------------------------------------------- numbers

function validCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

function haversineM(a, b) {
  const R = 6371000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function metresBetween(a, b) {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dy = (b[0] - a[0]) * 111_320;
  const dx = (b[1] - a[1]) * 111_320 * Math.cos(lat);
  return Math.hypot(dx, dy);
}

export function normalizePlatformRef(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/^PLATFORM\s+/, "").replace(/\s+/g, "");
  if (!raw) return "";
  return raw.replace(/^0+(?=\d)/, "");
}

// ---------------------------------------------------------- the request

function text(value, max = 24) {
  if (value == null) return null;
  const out = String(value).trim().slice(0, max);
  return out || null;
}

/** The stops of a request, or null when the body is not a usable service. */
export function readStops(body) {
  const raw = body?.stops;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_STOPS) return null;
  const stops = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const index = Number(row.index);
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isInteger(index) || index < 0 || seen.has(index) || !validCoordinate(lat, lng)) return null;
    seen.add(index);
    const kind = row.kind === "pass" || row.kind === "junction" ? row.kind : "stop";
    stops.push({
      index,
      lat,
      lng,
      crs: text(row.crs, 8),
      tpl: text(row.tpl, 12) || "",
      calling: row.calling === true,
      kind,
      cancelled: row.cancelled === true,
      platform: text(row.platform, 8),
      path: text(row.path, 8),
      line: text(row.line, 8),
    });
  }
  stops.sort((a, b) => a.index - b.index);
  return stops;
}

// ------------------------------------------------------- platform rules

function ruleCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return null;
  return new Set(codes.map((code) => String(code).toUpperCase()));
}

function matchesCode(stop, codes) {
  return codes.has(String(stop.crs || stop.tpl || "").toUpperCase()) || codes.has(String(stop.tpl || "").toUpperCase());
}

function placedOnTheMap(stop) {
  return Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && Math.abs(stop.lat) > 1;
}

/** Westbound is towards a smaller longitude: at Morley that is Huddersfield, rather than Leeds. */
function travellingWest(stops, here) {
  const placed = stops.filter((stop) => !stop.cancelled && placedOnTheMap(stop));
  const previous = [...placed].reverse().find((stop) => stop.index < here.index);
  const next = placed.find((stop) => stop.index > here.index);
  if (previous && next) return next.lng < previous.lng;
  if (next && placedOnTheMap(here)) return next.lng < here.lng;
  if (previous && placedOnTheMap(here)) return here.lng < previous.lng;
  return false;
}

/** Books the platform each matching rule names. Later rules win at the same stop. */
export function applyPlatformRules(stops, toc, rules) {
  const serviceToc = String(toc || "").trim().toUpperCase();
  let next = stops;
  for (const rule of rules || []) {
    const at = ruleCodes(rule.at);
    const platform = normalizePlatformRef(rule.platform);
    if (!at || !platform) continue;
    const allowedToc = ruleCodes(rule.toc);
    if (allowedToc && !allowedToc.has(serviceToc)) continue;
    const here = next.find((stop) => !stop.cancelled && matchesCode(stop, at));
    if (!here) continue;
    const originCodes = ruleCodes(rule.origin);
    if (originCodes) {
      const origin = next.find((stop) => stop.calling && !stop.cancelled);
      if (!origin || origin.index >= here.index || !matchesCode(origin, originCodes)) continue;
    }
    const before = ruleCodes(rule.before);
    if (before && !next.some((stop) => stop.index < here.index && !stop.cancelled && matchesCode(stop, before))) continue;
    const after = ruleCodes(rule.after);
    if (after && !next.some((stop) => stop.index > here.index && !stop.cancelled && matchesCode(stop, after))) continue;
    if (rule.direction === "west" && !travellingWest(next, here)) continue;
    if (rule.direction === "east" && travellingWest(next, here)) continue;
    if (Array.isArray(rule.replace)) {
      const booked = normalizePlatformRef(here.platform);
      if (!rule.replace.map((value) => normalizePlatformRef(value)).includes(booked)) continue;
    }
    next = next.map((stop) => (stop.index === here.index ? { ...stop, platform } : stop));
  }
  return next;
}

// ------------------------------------------------- which points to route

/** A timing point has to be further along towards the next call than the line already is. */
function stillAhead(from, point, next) {
  if (haversineM(from, point) < 25) return false;
  return haversineM(point, next) < haversineM(from, next) - 15;
}

/** Where a point sits along, and beside, the straight line between two places. */
function chordProgress(from, point, next) {
  const east = next.lng - from.lng;
  const north = next.lat - from.lat;
  const length = east * east + north * north;
  if (length < 1e-12) return null;
  const along = ((point.lng - from.lng) * east + (point.lat - from.lat) * north) / length;
  const offset = haversineM(point, { lat: from.lat + along * north, lng: from.lng + along * east });
  return { along, offset };
}

/**
 * A junction on the way to the next call is the booked divergence. A pin
 * behind the train, past the call, or many kilometres off the line is only a
 * marker. So is one listed before a pass it has already gone beyond.
 */
function junctionSteersTheRoute(from, point, next, later) {
  const here = chordProgress(from, point, next);
  if (!here || here.along <= 0 || here.along >= 1 || here.offset > 9_000) return false;
  if (!stillAhead(from, point, next)) return false;
  if (!later) return true;
  const after = chordProgress(from, later, next);
  if (after && after.along < here.along - 0.01) return false;
  return true;
}

/** Calling stops, passes that still lie ahead, and a junction only when it steers the booked line. */
function chosenRouteStops(mapped, platformAt) {
  const placed = mapped.filter((stop) => !stop.cancelled);
  const calls = placed.filter((stop) => stop.calling);
  const placeAt = (stop) => platformAt?.[String(stop.index)] ?? { lat: stop.lat, lng: stop.lng };
  if (calls.length < 2) return placed.filter((stop) => stop.kind !== "junction");
  const chosen = [];
  let nextCall = 0;
  for (let at = 0; at < placed.length; at++) {
    const stop = placed[at];
    if (stop.calling) {
      chosen.push(stop);
      nextCall += 1;
      continue;
    }
    const next = calls[nextCall];
    const from = chosen[chosen.length - 1];
    if (!next || !from) continue;
    if (stop.kind === "junction") {
      let later = null;
      for (let j = at + 1; j < placed.length; j++) {
        if (placed[j].kind !== "junction") {
          later = placed[j];
          break;
        }
      }
      if (!junctionSteersTheRoute(placeAt(from), placeAt(stop), placeAt(next), later && placeAt(later))) continue;
      chosen.push(stop);
      continue;
    }
    if (!stillAhead(placeAt(from), placeAt(stop), placeAt(next))) continue;
    chosen.push(stop);
  }
  return chosen;
}

// ------------------------------------------------------ direction of travel

function metresEastNorth(origin, point) {
  const lat = (origin.lat * Math.PI) / 180;
  return {
    x: (point.lng - origin.lng) * 111320 * Math.cos(lat),
    y: (point.lat - origin.lat) * 110540,
  };
}

/** A leg this far from the running direction is off to the side, not a new heading. */
const ASIDE_ALONG = Math.cos((70 * Math.PI) / 180);
/** A leg this far back has turned the train round. */
const REVERSAL_ALONG = -0.5;

function bearingOf(from, to) {
  const step = metresEastNorth(from, to);
  if (Math.hypot(step.x, step.y) < 40) return null;
  return Math.atan2(step.x, step.y);
}

function legAgainst(travel, from, to) {
  const step = metresEastNorth(from, to);
  const length = Math.hypot(step.x, step.y);
  if (length < 40) return "aside";
  const along = (step.x * Math.sin(travel) + step.y * Math.cos(travel)) / length;
  if (along <= REVERSAL_ALONG) return "reverse";
  if (along < ASIDE_ALONG) return "aside";
  return "forward";
}

function stepAlong(origin, travel) {
  const east = Math.sin(travel) * 250;
  const north = Math.cos(travel) * 250;
  const cos = Math.cos((origin.lat * Math.PI) / 180);
  return {
    from: origin,
    to: { lat: origin.lat + north / 110540, lng: origin.lng + east / (111320 * Math.max(0.2, cos)) },
  };
}

/**
 * The direction of travel at one stop, walking from the origin toward the
 * destination. A timing point off to the side does not move it. A reversal
 * does: the way back runs on the left of that new direction.
 */
function travelAt(stops, index) {
  const points = stops.map((stop) => ({ lat: stop.lat, lng: stop.lng }));
  let travel = null;
  const adopt = (from, to) => {
    const leg = bearingOf(from, to);
    if (leg == null) return;
    if (travel == null || legAgainst(travel, from, to) !== "aside") travel = leg;
  };
  for (let i = 1; i <= index; i++) adopt(points[i - 1], points[i]);
  if (index + 1 < points.length) {
    const next = points[index + 1];
    const leaving = bearingOf(points[index], next);
    if (leaving != null && (travel == null || legAgainst(travel, points[index], next) === "forward")) travel = leaving;
  }
  return travel == null ? null : stepAlong(points[index], travel);
}

/** Metres to the left of the direction from `from` to `to`, measured at `origin`. */
function leftOfDirection(from, to, origin, point) {
  const axis = metresEastNorth(from, to);
  const offset = metresEastNorth(origin, point);
  const length = Math.hypot(axis.x, axis.y);
  if (length < 1) return 0;
  return (axis.x * offset.y - axis.y * offset.x) / length;
}

// --------------------------------------------------------- road at a pass

function roadFace(place) {
  if (place.ends) {
    return { lat: (place.ends[0].lat + place.ends[1].lat) / 2, lng: (place.ends[0].lng + place.ends[1].lng) / 2 };
  }
  return { lat: place.lat, lng: place.lng };
}

const COMPASS_STEP = {
  E: { lat: 0, lng: 0.002 },
  W: { lat: 0, lng: -0.002 },
  N: { lat: 0.002, lng: 0 },
  S: { lat: -0.002, lng: 0 },
};

function compassCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (code === "E" || code === "EB" || code === "EAST") return "E";
  if (code === "W" || code === "WB" || code === "WEST") return "W";
  if (code === "N" || code === "NB" || code === "NORTH") return "N";
  if (code === "S" || code === "SB" || code === "SOUTH") return "S";
  return null;
}

function namedRoad(value, roads) {
  const ref = normalizePlatformRef(value);
  return ref && roads[ref] ? ref : null;
}

/** Fast lines often have no platform, as at Huntingdon. */
const FAST_LINE = /^(FL|UF|DF|F)$/;
/** Platforms further off the line between the stops either side are another route, as Retford low level is. */
const ON_LINE_M = 40;

/**
 * A pass with no booked platform. The path, then the line, names the road when
 * either is a platform number. A compass code names the direction of that road.
 * A fast line with no platform named passes no platform. Otherwise the train
 * takes the left-hand face of the through pair, on the left of the journey
 * from the origin toward the destination.
 */
function passingRoad(stop, prev, next, roads, travel) {
  if (!roads) return null;
  const faces = Object.entries(roads);
  if (!faces.length) return null;
  const named = namedRoad(stop.path, roads) || namedRoad(stop.line, roads) || namedRoad(prev?.line ?? null, roads);
  if (named) return roads[named];
  if (FAST_LINE.test(String(stop.path || stop.line || "").trim().toUpperCase())) return null;

  const compass = compassCode(stop.path) || compassCode(stop.line) || compassCode(prev?.line ?? null);
  const origin = { lat: stop.lat, lng: stop.lng };
  let from = travel?.from ?? (prev ? { lat: prev.lat, lng: prev.lng } : null);
  let to = travel?.to ?? (next ? { lat: next.lat, lng: next.lng } : null);
  if (compass) {
    const step = COMPASS_STEP[compass];
    from = origin;
    to = { lat: origin.lat + step.lat, lng: origin.lng + step.lng };
  } else if (!from && to) {
    from = origin;
  } else if (from && !to) {
    to = origin;
  }
  if (!from || !to) return { ...faces[0][1], guess: true };

  const offLine = faces.map(([, place]) => Math.abs(leftOfDirection(from, to, from, roadFace(place))));
  const closest = Math.min(...offLine);
  const onLine = faces.filter((_, i) => compass || offLine[i] - closest <= ON_LINE_M);
  const scored = onLine
    .map(([, place]) => ({ place, left: leftOfDirection(from, to, origin, roadFace(place)) }))
    .sort((a, b) => a.left - b.left);
  let pairStart = 0;
  let pairGap = Infinity;
  for (let i = 1; i < scored.length; i++) {
    const gap = scored[i].left - scored[i - 1].left;
    if (gap <= 12 && gap < pairGap) {
      pairGap = gap;
      pairStart = i - 1;
    }
  }
  const side = pairGap <= 12 ? scored.slice(pairStart, pairStart + 2) : scored;
  // Nothing names this road. It is the left-hand one by its position alone.
  return { ...side.reduce((best, row) => (row.left > best.left ? row : best), side[0]).place, guess: true };
}

// ------------------------------------------------------------ the points

/**
 * Each call and pass with the point it is routed through, in order. A
 * platform's stopping mark is exact; the platform alone is approximate.
 * `loose` is the station pin, where a point goes when the route shows it is
 * on the wrong track. A call with no booked platform is on its left-hand
 * road and marked as a guess.
 */
function railStops(mapped, platformAt, roadsAt) {
  const chosen = chosenRouteStops(mapped, platformAt).filter((stop) => stop.kind !== "junction");
  return chosen.map((stop, index) => {
    const pin = { lat: stop.lat, lng: stop.lng };
    const place = platformAt?.[String(stop.index)]
      ?? (stop.kind === "pass"
        ? passingRoad(stop, chosen[index - 1] ?? null, chosen[index + 1] ?? null, roadsAt?.[String(stop.index)], travelAt(chosen, index))
        : null);
    const call = stop.calling;
    const guess = { index: stop.index, ...(place?.guess ? { guess: true } : {}) };
    if (place?.stand) return { stop, via: { ...place.stand, loose: pin, call, ...guess } };
    if (place) return { stop, via: { lat: place.lat, lng: place.lng, loose: pin, call, ...guess } };
    return { stop, via: { ...pin, loose: pin, call, index: stop.index } };
  });
}

/**
 * The direction of travel, in degrees from north, at each call on the way
 * that has no booked platform. Five degrees keeps the platform lookup steady.
 */
export function unbookedCallBearings(mapped) {
  const chosen = chosenRouteStops(mapped).filter((stop) => stop.kind !== "junction");
  const bearings = {};
  chosen.forEach((stop, index) => {
    if (!stop.calling || stop.platform || index === 0 || index === chosen.length - 1) return;
    const travel = travelAt(chosen, index);
    const heading = travel && bearingOf(travel.from, travel.to);
    if (heading == null) return;
    bearings[String(stop.index)] = ((Math.round((heading * 180) / Math.PI / 5) * 5) % 360 + 360) % 360;
  });
  return bearings;
}

export function platformRouteWaypoints(mapped, platformAt, roadsAt) {
  const vias = [];
  for (const { stop, via } of railStops(mapped, platformAt, roadsAt)) {
    // A bare pin snaps to whichever track is nearest, often the right-hand one.
    if (stop.kind === "pass" && via.lat === stop.lat && via.lng === stop.lng) continue;
    const prev = vias[vias.length - 1];
    if (prev && Math.abs(prev.lat - via.lat) < 1e-6 && Math.abs(prev.lng - via.lng) < 1e-6) continue;
    vias.push(via);
  }
  return vias;
}

/** Where each call and pass marker sits on the platform it is routed through, by stop index. */
function railStopMarks(mapped, platformAt, roadsAt, offLine = new Set()) {
  const marks = {};
  for (const { stop, via } of railStops(mapped, platformAt, roadsAt)) {
    if (offLine.has(stop.index)) continue;
    if (via.lat === stop.lat && via.lng === stop.lng) continue;
    marks[String(stop.index)] = { lat: via.lat, lng: via.lng };
  }
  return marks;
}

// ------------------------------------------------------------- platforms

function readPair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = Number(value[0]);
  const lng = Number(value[1]);
  return validCoordinate(lat, lng) ? { lat, lng } : null;
}

/** A platform as `/api/platforms` writes it, with its points as `{ lat, lng }`. */
function readPlace(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  if (!validCoordinate(lat, lng)) return null;
  const place = { lat, lng };
  if (Array.isArray(value.ends) && value.ends.length >= 2) {
    const first = readPair(value.ends[0]);
    const second = readPair(value.ends[1]);
    if (first && second) place.ends = [first, second];
  }
  const bay = readPair(value.bay);
  if (bay) place.bay = bay;
  const stand = readPair(value.stand);
  if (stand) place.stand = stand;
  if (value.guess === true) place.guess = true;
  return place;
}

function sitsAtStation(stop, place) {
  const points = [place, ...(place.ends ?? []), place.bay, place.stand].filter(Boolean);
  return points.every((point) => haversineM(stop, point) <= PLATFORM_APPLY_M);
}

function platformRequests(mapped) {
  const bearings = unbookedCallBearings(mapped);
  const requests = [];
  for (const stop of mapped) {
    if (stop.kind === "junction") continue;
    const at = { lat: Number(stop.lat.toFixed(5)), lng: Number(stop.lng.toFixed(5)) };
    const bearing = bearings[String(stop.index)];
    if (stop.platform) requests.push({ id: String(stop.index), ...at, platform: stop.platform });
    else if (stop.kind !== "pass" && bearing != null) requests.push({ id: String(stop.index), ...at, platform: `left@${bearing}` });
    else if (stop.kind === "pass") requests.push({ id: `roads${stop.index}`, ...at, platform: "*" });
  }
  return requests;
}

/** The platform each stop is booked on, and every road at a pass with none booked. */
async function loadPlatforms(mapped, lookup) {
  const requests = platformRequests(mapped);
  const platformAt = {};
  const roadsAt = {};
  const wire = {};
  if (requests.length === 0) return { platformAt, roadsAt, wire };
  let coords = {};
  try {
    coords = await lookup(requests);
  } catch (error) {
    console.warn("service route platforms", error instanceof Error ? error.message : error);
  }
  const byIndex = new Map(mapped.map((stop) => [String(stop.index), stop]));
  for (const [id, value] of Object.entries(coords || {})) {
    const place = readPlace(value);
    if (!place) continue;
    const road = /^roads(\d+)~(.+)$/.exec(id);
    const stop = byIndex.get(road ? road[1] : id);
    if (!stop || !sitsAtStation(stop, place)) continue;
    if (road) {
      (roadsAt[road[1]] ??= {})[road[2]] = place;
    } else {
      platformAt[id] = place;
      wire[id] = value;
    }
  }
  return { platformAt, roadsAt, wire };
}

// -------------------------------------------------------- the rail route

/** A platform road this far from the train's own line belongs to another line through the station. */
const OWN_LINE_M = 8;

function metresFromPath(path, point) {
  const cos = Math.cos((point.lat * Math.PI) / 180);
  const px = point.lng * 111_320 * cos;
  const py = point.lat * 110_540;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][1] * 111_320 * cos;
    const ay = path[i - 1][0] * 110_540;
    const dx = path[i][1] * 111_320 * cos - ax;
    const dy = path[i][0] * 110_540 - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const away = Math.hypot(px - ax - dx * t, py - ay - dy * t);
    if (away < best) best = away;
  }
  return best;
}

/**
 * A pass with no booked platform is put on the left-hand platform road. That
 * is only right when the train runs past those platforms. At Salford Central
 * the platforms are on the Bolton lines, and a train for the Ordsall Chord
 * runs on the pair beside them: sending it through a platform pulled it onto
 * the wrong road. The line is first asked for without those passes. A guessed
 * road is kept only when that line runs along it or along the road next to it.
 * The stop indexes left out are returned with the points that stay.
 */
export async function passesOnTheLine(vias, route) {
  const guessed = (via) => via.guess && !via.call;
  const offLine = new Set();
  if (!vias.some(guessed)) return { vias, offLine };
  const sure = vias.filter((via) => !guessed(via));
  if (sure.length < 2) return { vias, offLine };
  // Most services keep every guess, so the line through all of them is
  // asked for at the same time and is ready when the check is done.
  Promise.resolve()
    .then(() => route(vias.map((via) => [via.lat, via.lng])))
    .catch(() => null);
  const base = await route(sure.map((via) => [via.lat, via.lng]));
  if (!base || base.length < 2) return { vias, offLine };
  const kept = vias.filter((via) => {
    if (!guessed(via) || metresFromPath(base, via) <= OWN_LINE_M) return true;
    offLine.add(via.index);
    return false;
  });
  return { vias: kept, offLine, base };
}

const routeCache = new Map();
const routeInFlight = new Map();

function routeKey(points) {
  return `geom${RAIL_ROUTE_REV}|${points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join("|")}`;
}

async function fetchRailRoute(points, lay = true) {
  const params = new URLSearchParams({
    fromLat: String(points[0][0]),
    fromLng: String(points[0][1]),
    toLat: String(points[points.length - 1][0]),
    toLng: String(points[points.length - 1][1]),
    strict: "1",
    rev: RAIL_ROUTE_REV,
  });
  // The site lays a line on the mapped rails only where it leaves a station.
  if (!lay) params.set("lay", "0");
  if (points.length > 2) params.set("via", points.slice(1, -1).map(([lat, lng]) => `${lat},${lng}`).join("|"));
  const response = await fetch(`${RAIL_ROUTE_URL}?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "RailStatistics-rail-core/1.0 (+https://railstatistics.co.uk)" },
    signal: AbortSignal.timeout(24_000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  if (!payload || payload.limited === true || payload.fallback === true) return null;
  if (!Array.isArray(payload.coordinates) || payload.coordinates.length < 2) return null;
  const path = [];
  for (const pair of payload.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return null;
    const lat = Number(pair[0]);
    const lng = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    path.push([lat, lng]);
  }
  return path;
}

// ----------------------------------------------------- long routes in legs

/** A route through more points than this is fetched as legs, side by side. */
const LEG_SPLIT_OVER = 14;
const LEG_STRIDE = 10;
/** The two legs either side of a seam must agree on where the line runs. */
const LEG_JOIN_M = 20;
/** Requests to the rail router in flight at once. */
const MAX_ROUTE_REQUESTS = 6;

let routeRequestsActive = 0;
const routeRequestWaiters = [];

function withRouteSlot(job, size = 0) {
  const queuedAt = Date.now();
  return new Promise((resolve, reject) => {
    const run = () => {
      routeRequestsActive += 1;
      const startedAt = Date.now();
      job().then(resolve, reject).finally(() => {
        const tookMs = Date.now() - startedAt;
        if (tookMs > 3000 || startedAt - queuedAt > 1000) {
          console.log(`rail route ${size}pts took ${tookMs}ms after waiting ${startedAt - queuedAt}ms for a slot`);
        }
        routeRequestsActive -= 1;
        routeRequestWaiters.shift()?.();
      });
    };
    if (routeRequestsActive < MAX_ROUTE_REQUESTS) run();
    else routeRequestWaiters.push(run);
  });
}

/**
 * A long route is one slow request, and a corrected line asks for it several
 * times. Cut at every tenth point, each leg runs a point either side of the
 * seam so the router still passes through it without turning back. The legs are
 * fetched together, kept one by one, and the next correction only asks for the
 * leg that changed. Null when the route is short enough to go in one.
 */
export function routeLegs(points) {
  if (points.length <= LEG_SPLIT_OVER) return null;
  const seams = [];
  for (let i = LEG_STRIDE; i < points.length - 3; i += LEG_STRIDE) seams.push(i);
  const legs = [];
  for (let m = 0; m <= seams.length; m++) {
    legs.push({
      from: m === 0 ? 0 : seams[m - 1] - 1,
      to: m === seams.length ? points.length - 1 : seams[m] + 1,
    });
  }
  return { seams, legs };
}

function nearestVertex(path, point) {
  let index = 0;
  let best = Infinity;
  path.forEach((vertex, i) => {
    const away = metresBetween(vertex, point);
    if (away < best) {
      best = away;
      index = i;
    }
  });
  return index;
}

/**
 * The legs as one line, each cut at the vertex nearest its seam point. Null
 * when two legs do not meet there, so the whole route is asked for instead.
 */
export function stitchLegs(paths, points, seams) {
  const cuts = seams.map((seam, m) => {
    const out = nearestVertex(paths[m], points[seam]);
    const back = nearestVertex(paths[m + 1], points[seam]);
    return metresBetween(paths[m][out], paths[m + 1][back]) <= LEG_JOIN_M ? { out, back } : null;
  });
  if (cuts.some((cut) => !cut)) return null;
  const joined = [];
  for (let m = 0; m < paths.length; m++) {
    const start = m === 0 ? 0 : cuts[m - 1].back + 1;
    const end = m === seams.length ? paths[m].length - 1 : cuts[m].out;
    if (end < start - 1) return null;
    for (let i = start; i <= end; i++) joined.push(paths[m][i]);
  }
  return joined.length >= 2 ? joined : null;
}

function keptRoute(points, load, tag = "") {
  const key = routeKey(points) + tag;
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return Promise.resolve(hit.path);
  const running = routeInFlight.get(key);
  if (running) return running;
  const request = load()
    .then((path) => {
      if (path) {
        routeCache.set(key, { at: Date.now(), path });
        if (routeCache.size > ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value);
      }
      return path;
    })
    .catch((error) => {
      console.warn("service route rail", error instanceof Error ? error.message : error);
      return null;
    })
    .finally(() => routeInFlight.delete(key));
  routeInFlight.set(key, request);
  return request;
}

/** One rail route through every point, on the left-hand line. A miss is null. */
export async function requestRailRoute(points) {
  if (points.length < 2) return null;
  return keptRoute(points, async () => {
    const plan = routeLegs(points);
    if (plan) {
      // Only the first leg leaves the station, so only it is laid on the mapped rails.
      const paths = await Promise.all(
        plan.legs.map(({ from, to }, m) => {
          const leg = points.slice(from, to + 1);
          const lay = m === 0;
          return keptRoute(leg, () => withRouteSlot(() => fetchRailRoute(leg, lay), leg.length), lay ? "" : "|plain");
        }),
      );
      // A leg that turns back on itself is asked for again with the lookup that corrects it.
      await Promise.all(
        paths.map(async (path, m) => {
          if (m === 0 || !path) return;
          const { from, to } = plan.legs[m];
          const leg = points.slice(from, to + 1);
          if (turnedBackAt(path, leg).length === 0) return;
          paths[m] = await keptRoute(leg, () => withRouteSlot(() => fetchRailRoute(leg, true), leg.length));
        }),
      );
      const joined = paths.every(Boolean) ? stitchLegs(paths, points, plan.seams) : null;
      if (joined) return joined;
    }
    return withRouteSlot(() => fetchRailRoute(points), points.length);
  });
}

function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad)
    - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return Math.atan2(y, x) / rad;
}

/** The path every `step` metres, each with its distance along. */
function resample(path, step) {
  const out = [{ at: 0, point: path[0] }];
  let along = 0;
  let next = step;
  for (let i = 1; i < path.length; i++) {
    const length = metresBetween(path[i - 1], path[i]);
    while (length > 0 && next <= along + length) {
      const t = (next - along) / length;
      out.push({
        at: next,
        point: [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t],
      });
      next += step;
    }
    along += length;
  }
  return out;
}

/** How far along the path each point is reached, in order. */
function distanceAlong(path, points) {
  const along = [0];
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + metresBetween(path[i - 1], path[i]));
  let from = 0;
  return points.map((point) => {
    let best = from;
    let bestAway = Infinity;
    for (let i = from; i < path.length; i++) {
      const away = metresBetween(point, path[i]);
      if (away < bestAway) {
        bestAway = away;
        best = i;
      }
    }
    from = best;
    return along[best];
  });
}

const TIP_M = 100;
const TURN_BACK_M = 1500;
/** The longest out-and-back to a crossover: South Elmsall to Adwick Junction is 6 km each way. */
const DETOUR_M = 15_000;

/**
 * Points the route reverses at: the heading flips by more than 150 degrees.
 * A point on the wrong track sits at the tip of the out-and-back, so a flip
 * blames the point it touches. The far end of the detour is a crossover, and
 * only blames a point when no point is at the tip.
 */
function turnedBackAt(path, points) {
  const samples = resample(path, 20);
  const flips = [];
  for (let i = 2; i < samples.length; i++) {
    const before = bearing(samples[i - 2].point, samples[i - 1].point);
    const after = bearing(samples[i - 1].point, samples[i].point);
    const turn = Math.abs(((after - before + 540) % 360) - 180);
    if (turn > 150) flips.push(samples[i - 1]);
  }
  const reached = distanceAlong(path, points);
  const nearest = (flip, within) => {
    let best = null;
    let bestGap = Infinity;
    points.forEach((point, index) => {
      const gap = Math.abs(reached[index] - flip.at);
      if (gap > within || metresBetween(point, flip.point) > within) return;
      if (gap < bestGap) {
        bestGap = gap;
        best = index;
      }
    });
    return best;
  };
  const atTip = flips.map((flip) => nearest(flip, TIP_M));
  const wrong = new Set();
  flips.forEach((flip, i) => {
    const tip = atTip[i];
    if (tip !== null) {
      wrong.add(tip);
      return;
    }
    const crossover = flips.some((other, j) => atTip[j] !== null && Math.abs(other.at - flip.at) <= DETOUR_M);
    if (crossover) return;
    const near = nearest(flip, TURN_BACK_M);
    if (near !== null) wrong.add(near);
  });
  return wrong;
}

const RECHECKS = 3;
/** A station pin is on the platform or the concourse, this close to the line that serves it. */
const CALL_ON_LINE_M = 80;

function routeMissesCall(path, pin) {
  const drawn = path.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (drawn.length < 2) return true;
  return !resample(drawn, 20).some((sample) => metresBetween(sample.point, pin) <= CALL_ON_LINE_M);
}

/**
 * The line through the points. Where the route reverses beside a point, that
 * point alone is wrong: a platform point falls back to its station and a bare
 * station is left out, and the route is asked again. An intermediate call on
 * its booked platform stays: the reverse there is the onward working, as at
 * Leeds for Bradford. A call with no booked platform is a guess: it goes back
 * to its pin, then is left out, and stays out only when the line still runs
 * through the station. `draft` stops at the first answer.
 */
export async function platformRailRoute(vias, route, draft = false) {
  if (vias.length < 2) return { path: null, complete: true };
  const loosened = new Set();
  const dropped = new Set();
  const onTrial = new Set();
  const tested = new Set();
  const last = vias.length - 1;
  const pointsNow = () => {
    const kept = [];
    vias.forEach((via, index) => {
      if (dropped.has(index)) return;
      kept.push({ index, point: loosened.has(index) ? [via.loose.lat, via.loose.lng] : [via.lat, via.lng] });
    });
    return kept;
  };
  let kept = pointsNow();
  let path = await route(kept.map((row) => row.point));
  if (draft && path) return { path, complete: false };
  for (let round = 0; path && round < RECHECKS; round++) {
    const wrong = turnedBackAt(path, kept.map((row) => row.point));
    let changed = false;
    for (const n of wrong) {
      const index = kept[n].index;
      const via = vias[index];
      const onPlatform = via.lat !== via.loose.lat || via.lng !== via.loose.lng;
      // Origin and destination stay eligible: a reverse there is the route
      // arriving from the wrong direction.
      if (via.call && index !== 0 && index !== last) {
        if (via.guess && !loosened.has(index)) {
          loosened.add(index);
          changed = true;
        } else if ((via.guess || !onPlatform) && !tested.has(index) && !dropped.has(index)) {
          dropped.add(index);
          onTrial.add(index);
          changed = true;
        }
        continue;
      }
      if (onPlatform && !loosened.has(index)) {
        loosened.add(index);
        changed = true;
      } else if (index !== 0 && index !== last && !dropped.has(index)) {
        dropped.add(index);
        changed = true;
      }
    }
    if (!changed) break;
    kept = pointsNow();
    let next = await route(kept.map((row) => row.point));
    if (!next) break;
    // The reverse was the booked working after all: without the call the
    // line no longer runs through the station. Put it back.
    const bypassed = [...onTrial].filter((index) => routeMissesCall(next, [vias[index].loose.lat, vias[index].loose.lng]));
    for (const index of onTrial) tested.add(index);
    onTrial.clear();
    if (bypassed.length) {
      for (const index of bypassed) dropped.delete(index);
      kept = pointsNow();
      next = await route(kept.map((row) => row.point));
      if (!next) break;
    }
    path = next;
  }
  if (path) return { path, complete: true };
  const loose = await route(vias.map((via) => [via.loose.lat, via.loose.lng]));
  return { path: loose, complete: true };
}

// --------------------------------------------------------------- drawing

const FILLET_MAX_TURN = (75 * Math.PI) / 180;
const FILLET_MIN_TURN = (8 * Math.PI) / 180;
const ROUTE_FILLET_M = 28;

function filletSharpBend(points, maxCut) {
  if (points.length < 3 || maxCut < 1) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const here = points[i];
    const next = points[i + 1];
    const d1 = Math.hypot(here[0] - prev[0], here[1] - prev[1]);
    const d2 = Math.hypot(next[0] - here[0], next[1] - here[1]);
    if (d1 < 1 || d2 < 1) {
      out.push(here);
      continue;
    }
    const v1x = (here[0] - prev[0]) / d1;
    const v1y = (here[1] - prev[1]) / d1;
    const v2x = (next[0] - here[0]) / d2;
    const v2y = (next[1] - here[1]) / d2;
    const turn = Math.acos(Math.min(1, Math.max(-1, v1x * v2x + v1y * v2y)));
    const cut = Math.min(maxCut, d1 * 0.45, d2 * 0.45);
    if (turn < FILLET_MIN_TURN || turn > FILLET_MAX_TURN || cut < 0.5) {
      out.push(here);
      continue;
    }
    const p1 = [here[0] - v1x * cut, here[1] - v1y * cut];
    const p2 = [here[0] + v2x * cut, here[1] + v2y * cut];
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
  out.push(points[points.length - 1]);
  const deduped = [];
  for (const point of out) {
    const last = deduped[deduped.length - 1];
    if (last && Math.round(last[0]) === Math.round(point[0]) && Math.round(last[1]) === Math.round(point[1])) continue;
    deduped.push(point);
  }
  return deduped.length >= 2 ? deduped : points;
}

/** Rounds the elbows in a rail route without moving it onto the next track. */
export function filletRailRoute(path) {
  if (path.length < 3) return path;
  const origin = path[0];
  const cos = Math.cos((origin[0] * Math.PI) / 180);
  if (cos < 0.2) return path;
  const xy = path.map((point) => [(point[1] - origin[1]) * 111_320 * cos, (point[0] - origin[0]) * 111_320]);
  return filletSharpBend(xy, ROUTE_FILLET_M).map(([east, north]) => [
    origin[0] + north / 111_320,
    origin[1] + east / (111_320 * cos),
  ]);
}

function snapToPath(point, path, maxM) {
  if (!path || path.length < 2) return point;
  let best = point;
  let bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const dy = path[i][0] - path[i - 1][0];
    const dx = path[i][1] - path[i - 1][1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.lng - path[i - 1][1]) * dx + (point.lat - path[i - 1][0]) * dy) / len2));
    const at = { lat: path[i - 1][0] + dy * t, lng: path[i - 1][1] + dx * t };
    const distance = haversineM(point, at);
    if (distance < bestD) {
      bestD = distance;
      best = at;
    }
  }
  return bestD > maxM ? point : best;
}

/**
 * Where each marker is drawn: the junction pin, the stopping mark, a
 * terminal's buffer, the routed point, the platform, then the line itself.
 */
function markerPoints(mapped, platformAt, marks, path) {
  const placeOnTrack = Boolean(path && path.length > mapped.length + 2);
  const first = mapped[0]?.index;
  const last = mapped[mapped.length - 1]?.index;
  const markers = {};
  for (const stop of mapped) {
    const id = String(stop.index);
    const place = platformAt[id];
    const terminal = stop.index === first || stop.index === last;
    const at = stop.kind === "junction"
      ? stop
      : place?.stand
        ? place.stand
        : terminal && place?.bay
          ? place.bay
          : marks[id] ?? place ?? (placeOnTrack ? snapToPath(stop, path, 250) : stop);
    markers[id] = [at.lat, at.lng];
  }
  return markers;
}

// ---------------------------------------------------------- the endpoint

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const answers = new Map();
const working = new Map();
const ANSWER_CACHE_MAX = 300;
const ANSWER_WITHIN_MS = 6000;
const NO_ANSWER = { path: null, complete: false, booked: {}, platforms: {}, marks: {}, markers: {}, revision: RAIL_ROUTE_REV };

/**
 * The answer for one service.
 *
 * `path` is the line as `[lat, lng]` pairs, or null when no rail route came
 * back. `booked` is the platform a rule changed, by stop index. `platforms`
 * is where each booked platform sits, as `/api/platforms` writes it. `marks`
 * is the point each stop is routed through and `markers` where each stop's
 * dot is drawn. `complete` is false for a draft: the first line, before a
 * point on the wrong track is corrected. `pending` means the line is still
 * being drawn and the same request should be sent again in a moment.
 */
export async function serviceRoute(body, options = {}) {
  const stops = readStops(body);
  if (!stops) return null;
  if (options.route || options.platforms || options.rules) return drawService(body, stops, options, null);
  // The same service is opened by many people and reopened often. Its answer is kept.
  const keyFor = (draft) => JSON.stringify([RAIL_ROUTE_REV, draft, String(body?.toc || ""), stops]);
  const cacheKey = keyFor(body?.draft === true);
  const hit = answers.get(cacheKey);
  if (hit && Date.now() - hit.at < ROUTE_CACHE_MS) return hit.answer;
  let job = working.get(cacheKey);
  if (!job) {
    job = drawService(body, stops, options, cacheKey)
      .catch((error) => {
        console.warn("service route", error instanceof Error ? error.message : error);
        return null;
      })
      .finally(() => working.delete(cacheKey));
    working.set(cacheKey, job);
  }
  // The proxy in front of this server gives up after eight seconds. A long
  // line that is not ready by then is still being drawn: the answer says so,
  // carries the first line when there is one, and the client asks again.
  let timer;
  const ready = await Promise.race([
    job,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), ANSWER_WITHIN_MS);
    }),
  ]);
  clearTimeout(timer);
  if (ready !== undefined) return ready ?? { ...NO_ANSWER, complete: true };
  const first = answers.get(keyFor(true));
  return { ...(first ? first.answer : NO_ANSWER), complete: false, pending: true };
}

async function drawService(body, stops, options, cacheKey) {
  const lookup = options.platforms ?? platformCoordsFor;
  const startedAt = Date.now();
  const calls = [];
  const rawRoute = options.route ?? requestRailRoute;
  // Each route request is timed, so a slow service shows where its time went.
  const route = async (points) => {
    const at = Date.now();
    const path = await rawRoute(points);
    calls.push(`${points.length}pts ${Date.now() - at}ms${path ? "" : " miss"}`);
    return path;
  };
  const rules = options.rules ?? readPlatformRules()?.rules ?? [];
  const draft = body?.draft === true;

  const mapped = applyPlatformRules(stops, body?.toc, rules);
  const booked = {};
  mapped.forEach((stop, i) => {
    if (stop.platform !== stops[i].platform) booked[String(stop.index)] = stop.platform;
  });
  const { platformAt, roadsAt, wire } = await loadPlatforms(mapped, lookup);
  const platformsMs = Date.now() - startedAt;
  const { vias, offLine, base } = await passesOnTheLine(platformRouteWaypoints(mapped, platformAt, roadsAt), route);
  // A draft is whichever line is ready first. The line without the guessed
  // passes has just been fetched, so it is not asked for twice.
  const drawn = draft && base ? { path: base, complete: false } : await platformRailRoute(vias, route, draft);
  const path = drawn.path && drawn.path.length >= 2 ? filletRailRoute(drawn.path) : null;
  const stopMarks = railStopMarks(mapped, platformAt, roadsAt, offLine);
  const marks = {};
  for (const [id, at] of Object.entries(stopMarks)) marks[id] = [at.lat, at.lng];
  const tookMs = Date.now() - startedAt;
  if (!options.route && tookMs > 2000) {
    console.log(`service route ${draft ? "draft" : "full"} ${tookMs}ms (${stops.length} stops, platforms ${platformsMs}ms): ${calls.join(", ")}`);
  }
  const answer = {
    path: path ? path.map(([lat, lng]) => [round6(lat), round6(lng)]) : null,
    complete: drawn.complete,
    booked,
    platforms: wire,
    marks,
    markers: markerPoints(mapped, platformAt, stopMarks, path),
    revision: RAIL_ROUTE_REV,
  };
  if (cacheKey && answer.path) {
    answers.set(cacheKey, { at: Date.now(), answer });
    if (answers.size > ANSWER_CACHE_MAX) answers.delete(answers.keys().next().value);
  }
  return answer;
}
