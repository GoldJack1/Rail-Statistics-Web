/**
 * Platforms for a station OpenStreetMap has not mapped them at, worked out from
 * the track and from which way the booked trains run.
 *
 * Trains run on the left. At a station with a pair of through tracks, the
 * platform that forward trains use is on the left-hand track for that direction
 * of travel, and the one that reverse trains use is on the other. So the
 * platform numbers need only be told apart by direction: each number's trains
 * are counted by which way they head, and the number goes to that track. A
 * station with one track needs no direction. Anything that cannot be told
 * apart is left out, not guessed.
 */

const TRACK_MAX_OFFSET_M = 80;
const TRACK_MERGE_M = 3;
/** The through pair at a station with more tracks is the closest two this near each other. */
const PAIR_MAX_GAP_M = 14;
const AXIS_RADIUS_M = 150;
const ALONG_SLACK_M = 30;
const MAX_TURN = (20 * Math.PI) / 180;
export const MIN_OBSERVATIONS = 5;
const PURITY = 0.85;

export function localFrame(lat0, lng0) {
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: (lat, lng) => ({ x: (lng - lng0) * kx, y: (lat - lat0) * ky }),
    toLatLng: (x, y) => ({ lat: lat0 + y / ky, lng: lng0 + x / kx }),
  };
}

/** The pieces of each line within `radiusM` of the pin, in metres east and north of it. */
export function segmentsNear(lines, frame, radiusM = 250) {
  const out = [];
  for (const line of lines) {
    let prev = null;
    for (const [lng, lat] of line) {
      const point = frame.toXY(lat, lng);
      if (prev) {
        const near = Math.min(
          Math.hypot(prev.x, prev.y),
          Math.hypot(point.x, point.y),
          Math.hypot((prev.x + point.x) / 2, (prev.y + point.y) / 2),
        );
        if (near <= radiusM) out.push({ a: prev, b: point });
      }
      prev = point;
    }
  }
  return out;
}

/** The unit vector of the line the through tracks run along, weighted by length near the pin. */
export function mainAxis(segments) {
  let c = 0;
  let s = 0;
  for (const { a, b } of segments) {
    const mid = Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (mid > AXIS_RADIUS_M) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    c += len * Math.cos(2 * angle);
    s += len * Math.sin(2 * angle);
  }
  if (c === 0 && s === 0) return null;
  let phi = Math.atan2(s, c) / 2;
  if (phi < 0) phi += Math.PI;
  return { x: Math.cos(phi), y: Math.sin(phi) };
}

/** The tracks across the line of travel: one per cluster of segments, left of forward positive. */
export function throughTracks(segments, axis) {
  const left = { x: -axis.y, y: axis.x };
  const found = [];
  for (const { a, b } of segments) {
    const angle = Math.abs(Math.atan2((b.x - a.x) * axis.y - (b.y - a.y) * axis.x, (b.x - a.x) * axis.x + (b.y - a.y) * axis.y));
    if (Math.min(angle, Math.PI - angle) > MAX_TURN) continue;
    const sa = a.x * axis.x + a.y * axis.y;
    const sb = b.x * axis.x + b.y * axis.y;
    const lo = Math.min(sa, sb);
    const hi = Math.max(sa, sb);
    if (lo > ALONG_SLACK_M || hi < -ALONG_SLACK_M) continue;
    const along = Math.min(Math.max(0, lo), hi);
    const t = hi === lo ? 0 : (along - sa) / (sb - sa);
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const offset = point.x * left.x + point.y * left.y;
    if (Math.abs(offset) > TRACK_MAX_OFFSET_M) continue;
    found.push({ offset, point });
  }
  found.sort((p, q) => p.offset - q.offset);
  const clusters = [];
  for (const item of found) {
    const last = clusters[clusters.length - 1];
    if (last && item.offset - last.top <= TRACK_MERGE_M) {
      last.items.push(item);
      last.top = item.offset;
    } else {
      clusters.push({ items: [item], top: item.offset });
    }
  }
  return clusters.map(({ items }) => {
    const offset = items.reduce((sum, item) => sum + item.offset, 0) / items.length;
    const nearest = items.reduce((best, item) => (Math.abs(item.point.x) + Math.abs(item.point.y) < Math.abs(best.point.x) + Math.abs(best.point.y) ? item : best), items[0]);
    return { offset, point: nearest.point, segments: items.length };
  });
}

/** The through pair: with more than two tracks, the closest two near each other. */
function throughPair(tracks) {
  if (tracks.length <= 2) return tracks;
  const byPin = [...tracks].sort((p, q) => Math.abs(p.offset) - Math.abs(q.offset));
  const pair = byPin.slice(0, 2).sort((p, q) => p.offset - q.offset);
  return pair[1].offset - pair[0].offset <= PAIR_MAX_GAP_M ? pair : null;
}

/**
 * `pin` is the station's `{ lat, lng }`, `lines` the rail near it (each a list
 * of `[lng, lat]`), `calls` each booked call as `{ ref, prev, next }`: its
 * platform and the places the train came from and went to, far enough off to
 * give the direction. Returns the tracks `{ ref, lat, lng }` it could place and
 * why it left each of the others out.
 */
export function derivePlatforms({ pin, lines, calls }) {
  const frame = localFrame(pin.lat, pin.lng);
  const segments = segmentsNear(lines, frame);
  const axis = mainAxis(segments);
  if (!axis) return { tracks: [], skipped: [{ ref: "*", reason: "no rail near the station" }] };
  const all = throughTracks(segments, axis);
  if (all.length === 0) return { tracks: [], skipped: [{ ref: "*", reason: "no track through the station" }] };

  const seen = new Map();
  for (const call of calls) {
    const ref = String(call.ref || "").trim().toUpperCase();
    if (!ref || !call.prev || !call.next) continue;
    const from = frame.toXY(call.prev.lat, call.prev.lng);
    const to = frame.toXY(call.next.lat, call.next.lng);
    const along = (to.x - from.x) * axis.x + (to.y - from.y) * axis.y;
    const row = seen.get(ref) ?? { forward: 0, reverse: 0 };
    if (along > 0) row.forward += 1;
    else if (along < 0) row.reverse += 1;
    seen.set(ref, row);
  }
  const refs = [...seen.entries()]
    .map(([ref, row]) => ({ ref, ...row, total: row.forward + row.reverse }))
    .filter((row) => row.total >= MIN_OBSERVATIONS);
  if (refs.length === 0) return { tracks: [], skipped: [{ ref: "*", reason: "too few bookings" }] };

  const place = (ref, track) => ({ ref, ...frame.toLatLng(track.point.x, track.point.y) });
  const skipped = [];
  const tracks = [];

  const pair = throughPair(all);
  if (!pair) return { tracks: [], skipped: [{ ref: "*", reason: "more than a pair of tracks" }] };
  if (pair.length === 1) {
    for (const row of refs) tracks.push(place(row.ref, pair[0]));
    return { tracks, skipped, axis, trackCount: all.length, refs };
  }
  const [rightHand, leftHand] = pair;
  const wants = new Map();
  for (const row of refs) {
    const share = row.forward / row.total;
    if (share >= PURITY) wants.set(row.ref, "forward");
    else if (share <= 1 - PURITY) wants.set(row.ref, "reverse");
    else skipped.push({ ref: row.ref, reason: "trains both ways" });
  }
  for (const direction of ["forward", "reverse"]) {
    const group = [...wants].filter(([, way]) => way === direction).map(([ref]) => ref);
    if (group.length !== 1) {
      for (const ref of group) skipped.push({ ref, reason: "another platform takes the same direction" });
      continue;
    }
    tracks.push(place(group[0], direction === "forward" ? leftHand : rightHand));
  }
  return { tracks, skipped, axis, trackCount: all.length, refs, offsets: pair.map((t) => Number(t.offset.toFixed(1))) };
}
