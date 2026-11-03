/** A call the train has already recorded. Estimates do not count. */
export function callWasRecorded(call) {
  return [call?.ata, call?.atd, call?.atp].some((value) => String(value || "").trim());
}

/** `TRUST:0002:I8` is a whole-service cancel. `TRUST:0002:I8@YORK` starts at that TIPLOC. */
export function parseTrustCancel(reason) {
  const match = /^TRUST:0002(?::([^@]+))?(?:@(.+))?$/.exec(String(reason || "").trim());
  if (!match) return null;
  return { code: match[1] || "", tiploc: match[2] ? match[2].toUpperCase() : "" };
}

export function trustCancelReason(code, tiploc) {
  const base = `TRUST:0002${code ? `:${String(code).trim()}` : ""}`;
  return tiploc ? `${base}@${String(tiploc).toUpperCase()}` : base;
}

export function cancellationReason(reason) {
  const text = String(reason || "").trim();
  const trust = parseTrustCancel(text);
  if (!trust) return { source: "ts", reason: text || "Cancelled" };
  const out = { source: "ts", reason: trust.tiploc ? "Cancelled en route" : "Cancelled" };
  if (trust.code) out.code = trust.code;
  return out;
}

/**
 * A later Darwin timetable update does not say the train is running again.
 * Keep the TRUST cancellation until a TRUST reinstatement clears it.
 */
export function mergeStoredCancel(existing, incoming) {
  const incomingReason = incoming?.cancel_reason ?? null;
  const trust = parseTrustCancel(existing?.cancel_reason);
  const silentClear = !Number(incoming?.cancelled) && !String(incomingReason || "").trim();
  if (existing && trust && silentClear) {
    return {
      cancelled: Number(existing.cancelled) ? 1 : 0,
      cancel_reason: existing.cancel_reason,
    };
  }
  return { cancelled: incoming?.cancelled ? 1 : 0, cancel_reason: incomingReason };
}

/**
 * A whole-service cancellation covers every call still to be served.
 * A call that already has an actual stays as it ran.
 * A call row flagged cancelled is cancelled even when the service is not.
 */
export function cancellationForCall(call, serviceCancelled, reason) {
  const own = Boolean(Number(call?.cancelled));
  const inherited = Boolean(serviceCancelled) && !callWasRecorded(call);
  if (!own && !inherited) return { cancelledAtStop: false, cancelReasonAtStop: null };
  return {
    cancelledAtStop: true,
    cancelReasonAtStop: cancellationReason(reason),
  };
}

export function serviceCancellationFields(svc, stops) {
  const cancelled = Boolean(Number(svc?.cancelled));
  const publicCancelled = (stops || []).some(
    (stop) => stop.cancelledAtStop && stop.slot !== "PP" && stop.slot !== "OPPP",
  );
  return {
    cancelled,
    cancellation: cancelled ? cancellationReason(svc?.cancel_reason) : null,
    partiallyCancelled: !cancelled && publicCancelled,
  };
}
