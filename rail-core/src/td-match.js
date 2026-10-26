/**
 * A Train Describer step is a berth movement for a headcode, not a confirmed
 * pass. Dummy and cancel berths are not locations, and a headcode is reused
 * by later trains the same day.
 */

/** Berths that describe a panel action, not a place on the network. */
const SIGNALLING_BERTHS = new Set(["DUMY", "DUMMY", "COUT"]);

/** A reused headcode can still be stepping from the previous working. */
const HEADCODE_ACTUAL_MATCH_MIN = 8 * 60;
/** A pass more than this early is another train, not this one running hot. */
const EARLY_ACTUAL_LIMIT_MIN = 10;

export function isSignallingBerth(berth) {
  const s = String(berth || "").trim().toUpperCase();
  return SIGNALLING_BERTHS.has(s);
}

/** Minutes from booked to actual. Positive means late. Wraps across midnight. */
export function minutesAfter(actual, booked) {
  let delta = actual - booked;
  if (delta < -12 * 60) delta += 1440;
  else if (delta > 12 * 60) delta -= 1440;
  return delta;
}

/**
 * Keep an actual that is up to ten minutes early or several hours late.
 * A step from the previous working is hours away, or already past a timing
 * point this train has not reached.
 */
export function actualBelongsToBooked(booked, actual) {
  if (booked == null || actual == null) return false;
  const late = minutesAfter(actual, booked);
  return late >= -EARLY_ACTUAL_LIMIT_MIN && late <= HEADCODE_ACTUAL_MATCH_MIN;
}

/**
 * Named places from one train's describer steps, in the order the train
 * stepped through them. A berth with no place name is a signal and is left
 * out. The same place stepped twice in a row is kept once. Pass fromMs and
 * toMs so another working of the same headcode is not mixed in.
 */
export function namedPointsFromTdSteps(steps, { fromMs = null, toMs = null } = {}) {
  const ordered = [...(steps || [])].sort(
    (a, b) => Number(a?.receivedAt || 0) - Number(b?.receivedAt || 0),
  );
  const points = [];
  for (const step of ordered) {
    const type = String(step?.msgType || "CA").toUpperCase();
    if (type !== "CA" && type !== "CC") continue;
    if (isSignallingBerth(step?.berth)) continue;
    const at = Number(step?.receivedAt || 0);
    if (fromMs != null && at < fromMs) continue;
    if (toMs != null && at > toMs) continue;
    const tiploc = String(step?.tiploc || "").trim().toUpperCase();
    const name = String(step?.name || "").trim();
    if (!tiploc || !name) continue;
    if (points.length && points[points.length - 1].tiploc === tiploc) continue;
    const crs = String(step?.crs || "").trim().toUpperCase();
    points.push({ tiploc, name, crs: crs.length === 3 ? crs : "" });
  }
  return points;
}
