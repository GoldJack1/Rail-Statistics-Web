/**
 * A Train Describer step is a berth movement for a headcode, not a confirmed
 * pass. Dummy and cancel berths are not locations, and a headcode is reused
 * by later trains the same day.
 */
import { addCalendarDays, londonCalendarYmd, londonInstant, ssdFromRid } from "./calendar-day.js";

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

function clockMinute(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function hhmmClock(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || "").trim());
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Booked London instant. A morning call after an evening origin is the next calendar day. */
export function bookedInstantForRid(rid, bookedClock, originClock) {
  const ssd = ssdFromRid(rid);
  const bookedMin = clockMinute(bookedClock);
  if (!ssd || bookedMin == null) return null;
  const originMin = clockMinute(originClock);
  const ymd = originMin != null && originMin >= 12 * 60 && bookedMin < 12 * 60 ? addCalendarDays(ssd, 1) : ssd;
  return londonInstant(ymd, hhmmClock(bookedClock));
}

/** The latest London occurrence of this clock at or just after now. */
export function latestClockInstant(clock, now = Date.now()) {
  const today = londonCalendarYmd(new Date(now));
  const at = londonInstant(today, hhmmClock(clock));
  if (!at) return null;
  if (at.getTime() > now + 2 * 60 * 1000) return londonInstant(addCalendarDays(today, -1), hhmmClock(clock));
  return at;
}

/**
 * A headcode reused overnight has the same booked clocks on two RIDs.
 * Keep the step only when that clock last happened near this RID's booked instant.
 */
export function tdClockBelongsToRid(rid, bookedClock, actualClock, originClock, now = Date.now()) {
  const bookedAt = bookedInstantForRid(rid, bookedClock, originClock);
  const actualAt = latestClockInstant(actualClock, now);
  if (!bookedAt || !actualAt) return true;
  const lateMin = (actualAt.getTime() - bookedAt.getTime()) / 60_000;
  return lateMin >= -EARLY_ACTUAL_LIMIT_MIN && lateMin <= HEADCODE_ACTUAL_MATCH_MIN;
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
