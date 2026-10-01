import { test } from "node:test";
import assert from "node:assert/strict";
import { keepBoardRow, computeDelayMinutes, classifyServiceType } from "./board-build.js";

test("live CIS drops actuals after 30s hold", () => {
  const scheduledAt = new Date("2026-09-30T12:00:00+01:00");
  const now = new Date(scheduledAt.getTime() + 31_000);
  const horizon = new Date(scheduledAt.getTime() + 3600_000);
  assert.equal(
    keepBoardRow({
      now,
      horizon,
      scheduledAt,
      liveTime: "12:00",
      liveKind: "actual",
      ssd: "2026-09-30",
      cancelled: false,
    }),
    false,
  );
});

test("live CIS keeps unactualed rows for 5 minutes lookback", () => {
  const scheduledAt = new Date("2026-09-30T12:00:00+01:00");
  const now = new Date(scheduledAt.getTime() + 2 * 60_000);
  const horizon = new Date(scheduledAt.getTime() + 3600_000);
  assert.equal(
    keepBoardRow({
      now,
      horizon,
      scheduledAt,
      liveTime: null,
      liveKind: "scheduled",
      ssd: "2026-09-30",
      cancelled: false,
    }),
    true,
  );
});

test("delay minutes wrap overnight", () => {
  assert.equal(computeDelayMinutes("23:50", "00:05", "est"), 15);
});

test("classify passenger vs freight", () => {
  assert.equal(classifyServiceType({ trainCat: "XX", isPassenger: true, trainId: "1A01" }), "passenger");
  assert.equal(classifyServiceType({ trainCat: "EE", isPassenger: false, trainId: "6A01" }), "freight");
});
