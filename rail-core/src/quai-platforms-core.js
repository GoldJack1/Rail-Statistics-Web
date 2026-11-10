// Server copy of new-site/src/utils/quaiPlatforms.ts.
// Rebuild with: cd new-site && ./node_modules/.bin/esbuild src/utils/quaiPlatforms.ts --bundle --format=esm --platform=neutral --outfile=../rail-core/src/quai-platforms-core.js
// src/utils/stationCoordinates.ts
function isValidStationCoordinate(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

// src/utils/platformPosition.ts
function normalizePlatformRef(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/^PLATFORM\s+/, "").replace(/\s+/g, "");
  if (!raw) return "";
  return raw.replace(/^0+(?=\d)/, "");
}
function haversineM(a, b) {
  const R = 6371e3;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function parsePlatformQuery(raw) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const part of String(raw || "").split("|")) {
    if (!part) continue;
    const [idRaw, latRaw, lngRaw, platformRaw] = part.split("~");
    const id = String(idRaw || "").trim();
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    let platform = "";
    try {
      platform = decodeURIComponent(String(platformRaw || ""));
    } catch {
      platform = String(platformRaw || "");
    }
    platform = platform.trim();
    if (!id || seen.has(id) || !platform || !isValidStationCoordinate(lat, lng)) continue;
    seen.add(id);
    if (out.length >= 40) break;
    out.push({ id, lat, lng, platform });
  }
  return out;
}
var HUDDERSFIELD = { lat: 53.64843, lng: -1.78515 };
function atHuddersfield(anchor) {
  return haversineM(anchor, HUDDERSFIELD) <= 500;
}
function stationBookedRef(anchor, platform) {
  const ref = normalizePlatformRef(platform);
  if (!ref || !atHuddersfield(anchor)) return platform;
  if (ref === "4" || ref === "4A" || ref === "4B") return "3";
  return platform;
}
function locationKey(lat, lng) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}
function asTrack(point) {
  const here = { lat: point.lat, lng: point.lng };
  return {
    lat: point.lat,
    lng: point.lng,
    ends: point.ends ?? [here, here],
    ...point.bay ? { bay: point.bay } : {},
    ...point.stand ? { stand: point.stand } : {}
  };
}
function resolvePlatform(byRef, platform) {
  const want = normalizePlatformRef(platform);
  if (!want) return null;
  if (byRef[want]) return asTrack(byRef[want]);
  if (!/^\d+$/.test(want)) return null;
  const faces = Object.entries(byRef).filter(
    ([ref]) => ref.startsWith(want) && ref.length === want.length + 1 && /[A-Z]$/.test(ref)
  );
  if (!faces.length) return null;
  const tracks = faces.map(([, point]) => asTrack(point));
  const tips = tracks.flatMap((track) => track.ends);
  let endA = tips[0];
  let endB = tips[tips.length - 1];
  let span = -1;
  for (const a of tips) {
    for (const b of tips) {
      const distance = haversineM(a, b);
      if (distance > span) {
        span = distance;
        endA = a;
        endB = b;
      }
    }
  }
  const bays = tracks.flatMap((track) => track.bay ? [track.bay] : []);
  return {
    lat: tracks.reduce((sum, track) => sum + track.lat, 0) / tracks.length,
    lng: tracks.reduce((sum, track) => sum + track.lng, 0) / tracks.length,
    ends: [endA, endB],
    ...bays.length === 1 ? { bay: bays[0] } : {}
  };
}

// src/utils/quaiPlatforms.ts
function quaiTrackPoints(_anchor, tracks) {
  const byRef = {};
  for (const track of tracks) {
    const ref = normalizePlatformRef(track.ref);
    if (!ref || !Number.isFinite(track.lat) || !Number.isFinite(track.lng)) continue;
    if (byRef[ref]?.stand && !track.on_track) continue;
    const here = { lat: track.lat, lng: track.lng };
    byRef[ref] = { ...here, ends: [here, here], ...track.on_track ? { stand: here } : {} };
  }
  return byRef;
}
function encodeTrack(track) {
  const body = {
    lat: track.lat,
    lng: track.lng,
    ends: [
      [track.ends[0].lat, track.ends[0].lng],
      [track.ends[1].lat, track.ends[1].lng]
    ]
  };
  if (track.bay) body.bay = [track.bay.lat, track.bay.lng];
  if (track.stand) body.stand = [track.stand.lat, track.stand.lng];
  return body;
}
function writePlatformCoords(coords, request, byRef) {
  if (request.platform === "*") {
    for (const [ref, track] of Object.entries(byRef)) coords[`${request.id}~${ref}`] = encodeTrack(track);
    return;
  }
  const platform = resolvePlatform(byRef, stationBookedRef(request, request.platform));
  if (platform) coords[request.id] = encodeTrack(platform);
}
async function lookupQuaiPlatforms(requests, stationTracks) {
  const groups = /* @__PURE__ */ new Map();
  for (const request of requests) {
    const key = locationKey(request.lat, request.lng);
    const group = groups.get(key);
    if (group) group.push(request);
    else groups.set(key, [request]);
  }
  const coords = {};
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const anchor = group[0];
      const tracks = await stationTracks(anchor.lat, anchor.lng);
      if (!tracks) return;
      const byRef = quaiTrackPoints(anchor, tracks);
      for (const request of group) writePlatformCoords(coords, request, byRef);
    })
  );
  return coords;
}
export {
  lookupQuaiPlatforms,
  parsePlatformQuery,
  quaiTrackPoints,
  writePlatformCoords
};
