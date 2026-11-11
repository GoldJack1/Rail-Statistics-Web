/**
 * The road a train takes at a call with no booked platform: the left-hand
 * one of the through pair, for its direction of travel.
 *
 * The site asks `/api/platforms` for `id~lat~lng~left@<bearing>`, where the
 * bearing is the direction of travel in degrees clockwise from north. The
 * answer is that road, marked `guess`, so the map does not route the call
 * through the station pin. A pin snaps to whichever track is nearest, and on
 * the right-hand one the route runs to the next junction and shunts back, as
 * a northbound call at Northallerton did.
 */
const LEFT = /^left@(-?\d+(?:\.\d+)?)$/i;
/** Platforms further off the line of travel are another route, as Retford low level is. */
const ON_LINE_M = 40;
/** The two faces of a through pair are closer together than this. */
const PAIR_GAP_M = 12;

/** The bearing a `left@` platform asks for, or null for any other platform. */
export function leftBearing(platform) {
  const match = LEFT.exec(String(platform || "").trim());
  if (!match) return null;
  const bearing = Number(match[1]);
  return Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : null;
}

function faceOf(place) {
  const ends = place?.ends;
  if (Array.isArray(ends) && ends.length >= 2 && Array.isArray(ends[0]) && Array.isArray(ends[1])) {
    return { lat: (Number(ends[0][0]) + Number(ends[1][0])) / 2, lng: (Number(ends[0][1]) + Number(ends[1][1])) / 2 };
  }
  return { lat: Number(place?.lat), lng: Number(place?.lng) };
}

/** Metres to the left of the direction of travel, measured from the station. */
function leftOf(origin, bearing, point) {
  const rad = (bearing * Math.PI) / 180;
  const x = (point.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const y = (point.lat - origin.lat) * 110_540;
  return y * Math.sin(rad) - x * Math.cos(rad);
}

/**
 * `roads` are the station's platforms as `/api/platforms` writes them. The
 * closest pair of faces on the line of travel is the through pair, and the
 * left-hand face of it is the road. With no such pair, the left-most face on
 * the line is. Null when the station has no platform placed.
 */
export function leftHandRoad(origin, bearing, roads) {
  const scored = [];
  for (const place of roads || []) {
    const face = faceOf(place);
    if (!Number.isFinite(face.lat) || !Number.isFinite(face.lng)) continue;
    scored.push({ place, left: leftOf(origin, bearing, face) });
  }
  if (scored.length === 0) return null;
  const closest = Math.min(...scored.map((row) => Math.abs(row.left)));
  const onLine = scored
    .filter((row) => Math.abs(row.left) - closest <= ON_LINE_M)
    .sort((a, b) => a.left - b.left);
  let pairStart = 0;
  let pairGap = Infinity;
  for (let i = 1; i < onLine.length; i++) {
    const gap = onLine[i].left - onLine[i - 1].left;
    if (gap <= PAIR_GAP_M && gap < pairGap) {
      pairGap = gap;
      pairStart = i - 1;
    }
  }
  const side = pairGap <= PAIR_GAP_M ? onLine.slice(pairStart, pairStart + 2) : onLine;
  return side.reduce((best, row) => (row.left > best.left ? row : best), side[0]).place;
}

/** Each `left@` request as a request for every road at that station. */
export function roadRequests(requests) {
  return requests.map((request) => (
    leftBearing(request.platform) == null
      ? request
      : { ...request, id: `${request.id}~left`, platform: "*" }
  ));
}

/** Replace the roads fetched for a `left@` request with the one left-hand road. */
export function chooseLeftHandRoads(coords, requests) {
  for (const request of requests) {
    const bearing = leftBearing(request.platform);
    if (bearing == null) continue;
    const prefix = `${request.id}~left~`;
    const roads = [];
    for (const key of Object.keys(coords)) {
      if (!key.startsWith(prefix)) continue;
      roads.push(coords[key]);
      delete coords[key];
    }
    const road = leftHandRoad({ lat: request.lat, lng: request.lng }, bearing, roads);
    if (road) coords[request.id] = { ...road, guess: true };
  }
  return coords;
}
