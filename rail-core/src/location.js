import { londonInstant } from "./calendar-day.js";
import { isWorkingPass, parseHmMinutes, sortCallsByJourneyTime } from "./journey-order.js";

function isPass(c) {
  return isWorkingPass(c);
}

function actualClock(c) {
  if (c.atd) return { at: c.atd, kind: isPass(c) ? "pass" : "stop", source: c.actual_source || "darwin" };
  if (c.ata) return { at: c.ata, kind: isPass(c) ? "pass" : "stop", source: c.actual_source || "darwin" };
  if (c.atp) return { at: c.atp, kind: "pass", source: c.actual_source || "trust" };
  return null;
}

function nameOf(c, stationName) {
  if (typeof stationName === "function") return stationName(c.crs, c.tiploc) || c.crs || c.tiploc;
  return c.crs || c.tiploc;
}

function point(c) {
  return {
    tiploc: c.tiploc || "",
    crs: c.crs || null,
    kind: isPass(c) ? "pass" : "stop",
  };
}

export function computeServiceLocation(calls, opts = {}) {
  const journey = sortCallsByJourneyTime(calls || []);
  const now = opts.now instanceof Date ? opts.now : new Date();
  const ymd = opts.ymd;
  if (!journey.length) {
    return { phase: "not_started", last: null, next: null, label: "Not started", fresh: false };
  }
  let lastIdx = -1;
  for (let i = 0; i < journey.length; i++) {
    if (actualClock(journey[i])) lastIdx = i;
  }
  const dest = [...journey].reverse().find((c) => !isPass(c)) || journey[journey.length - 1];
  const destActual = dest ? actualClock(dest) && dest.ata : false;

  if (lastIdx < 0) {
    const first = journey.find((c) => !isPass(c)) || journey[0];
    return {
      phase: "not_started",
      last: null,
      next: point(first),
      label: `Not left ${nameOf(first, opts.stationName)}`,
      fresh: false,
    };
  }

  const seedIdx = lastIdx;
  const seedCall = journey[seedIdx];
  const seedAct = actualClock(seedCall);

  // After leaving a public stop, name the next working location (including
  // passes) once its booked time has elapsed — not the next advertised call.
  if (seedAct && !(!isPass(seedCall) && seedCall.ata && !seedCall.atd)) {
    while (lastIdx + 1 < journey.length) {
      const nxt = journey[lastIdx + 1];
      if (actualClock(nxt)) {
        lastIdx += 1;
        continue;
      }
      if (!isPass(nxt)) break;
      const booked = nxt.atp || nxt.etp || nxt.wtp || nxt.wtd || nxt.wta || nxt.std || nxt.sta;
      const inst = booked && ymd ? londonInstant(ymd, String(booked).slice(0, 5)) : null;
      if (inst && now.getTime() >= inst.getTime()) {
        lastIdx += 1;
        continue;
      }
      break;
    }
  }

  const lastCall = journey[lastIdx];
  const act = actualClock(lastCall) || seedAct;
  const last = {
    ...point(lastCall),
    at: act.at,
    source: act.source,
    kind: act.kind,
  };
  const nextCall = journey[lastIdx + 1] || null;
  const fresh = locationIsFresh(act.at, ymd, now);

  if (destActual && lastCall === dest) {
    return {
      phase: "finished",
      last,
      next: null,
      label: `Arrived ${nameOf(dest, opts.stationName)}`,
      fresh,
    };
  }

  const destBooked = dest?.sta || dest?.ata || dest?.std;
  const destAt = destBooked && ymd ? londonInstant(ymd, String(destBooked).slice(0, 5)) : null;
  const destOverdue = destBooked && ymd && destAt && !locationIsFresh(destBooked, ymd, now, 40 * 60_000) && now.getTime() > destAt.getTime();
  if (!fresh && destOverdue) {
    return {
      phase: "finished",
      last,
      next: null,
      label: destActual ? `Arrived ${nameOf(dest, opts.stationName)}` : `No later reports after ${nameOf(lastCall, opts.stationName)}`,
      fresh: false,
    };
  }

  const atStation = !isPass(lastCall) && lastCall.ata && !lastCall.atd;
  if (atStation) {
    return {
      phase: "at_station",
      last,
      next: nextCall ? point(nextCall) : null,
      label: `At ${nameOf(lastCall, opts.stationName)}`,
      fresh,
    };
  }

  if (nextCall) {
    const between = !isPass(lastCall) && lastCall.atd;
    return {
      phase: between ? "between" : "approaching",
      last,
      next: point(nextCall),
      label: `Between ${nameOf(lastCall, opts.stationName)} and ${nameOf(nextCall, opts.stationName)}`,
      fresh,
    };
  }

  return {
    phase: "approaching",
    last,
    next: dest ? point(dest) : null,
    label: `Approaching ${nameOf(dest || lastCall, opts.stationName)}`,
    fresh,
  };
}

export function locationIsFresh(lastAt, ymd, now, maxAgeMs = 20 * 60_000) {
  const mins = parseHmMinutes(lastAt);
  if (mins == null || !ymd) return false;
  const hh = String(Math.floor(mins / 60)).padStart(2, "0");
  const mm = String(mins % 60).padStart(2, "0");
  const t = londonInstant(ymd, `${hh}:${mm}`);
  if (!t) return false;
  return now.getTime() - t.getTime() >= 0 && now.getTime() - t.getTime() < maxAgeMs;
}
