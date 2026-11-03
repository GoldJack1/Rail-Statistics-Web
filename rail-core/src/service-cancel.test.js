import test from "node:test";
import assert from "node:assert/strict";
import { cancellationForCall, serviceCancellationFields } from "./service-cancel.js";

test("a cancelled service marks only calls that have not been recorded", () => {
  const ran = cancellationForCall({ atd: "12:30", cancelled: 0 }, 1, "TRUST:0002:I8");
  const ahead = cancellationForCall({ etd: "13:28", cancelled: 0 }, 1, "TRUST:0002:I8");
  assert.equal(ran.cancelledAtStop, false);
  assert.equal(ahead.cancelledAtStop, true);
  assert.deepEqual(ahead.cancelReasonAtStop, { source: "ts", reason: "TRUST:0002:I8" });
});

test("a running service stays clear unless the call itself is cancelled", () => {
  assert.equal(cancellationForCall({ etd: "13:28", cancelled: 0 }, 0, null).cancelledAtStop, false);
  const own = cancellationForCall({ etd: "13:28", cancelled: 1 }, 0, "Cancelled at Leeds");
  assert.equal(own.cancelledAtStop, true);
  assert.equal(own.cancelReasonAtStop.reason, "Cancelled at Leeds");
});

test("partial cancellation is only set when the service itself is still running", () => {
  const stops = [
    { slot: "OR", cancelledAtStop: false },
    { slot: "IP", cancelledAtStop: true },
    { slot: "PP", cancelledAtStop: true },
  ];
  assert.equal(serviceCancellationFields({ cancelled: 0 }, stops).partiallyCancelled, true);
  const whole = serviceCancellationFields({ cancelled: 1, cancel_reason: "TRUST:0002:I8" }, stops);
  assert.equal(whole.cancelled, true);
  assert.equal(whole.partiallyCancelled, false);
  assert.equal(whole.cancellation.reason, "TRUST:0002:I8");
});
