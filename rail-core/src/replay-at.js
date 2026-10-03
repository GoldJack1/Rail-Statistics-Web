import { liveKind } from "./db.js";
import { parseHmMinutes, railwayDayMinutes } from "./journey-order.js";

/** True when `clock` is strictly after `at` on the 02:00–01:59 railway day. */
export function clockAfter(at, clock) {
  const a = railwayDayMinutes(parseHmMinutes(at));
  const b = railwayDayMinutes(parseHmMinutes(clock));
  if (a == null || b == null) return false;
  return b > a;
}

export function maskCallAsOf(call, at) {
  if (!at || !call) return call;
  const next = { ...call };
  // Actuals are events: hide those that had not happened yet.
  // Forecasts are predictions: keep eta/etd/etp even when the predicted clock is after `at`.
  if (next.ata && clockAfter(at, next.ata)) next.ata = null;
  if (next.atd && clockAfter(at, next.atd)) next.atd = null;
  if (next.atp && clockAfter(at, next.atp)) next.atp = null;
  next.live_kind = liveKind(next);
  return next;
}

export function maskCallsAsOf(calls, at) {
  if (!at) return calls;
  return (calls || []).map((c) => maskCallAsOf(c, at));
}

/** Live CIS is Darwin-only: drop TRUST-filled actuals so they never appear on boards. */
export function maskTrustOverlay(call) {
  if (!call || call.actual_source !== "trust") return call;
  const next = { ...call, ata: null, atd: null, atp: null, actual_source: null, delay_minutes: null, status: null };
  next.live_kind = liveKind(next);
  return next;
}

export function maskTrustOverlayCalls(calls) {
  return (calls || []).map(maskTrustOverlay);
}

export function parseAtParam(raw) {
  const s = String(raw || "").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s) || /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
