/** A call the train has already recorded. Estimates do not count. */
export function callWasRecorded(call) {
  return [call?.ata, call?.atd, call?.atp].some((value) => String(value || "").trim());
}

export function cancellationReason(reason) {
  const text = String(reason || "").trim();
  return { source: "ts", reason: text || "Cancelled" };
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
