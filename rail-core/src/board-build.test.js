import { test } from "node:test";
import assert from "node:assert/strict";
import { keepBoardRow, computeDelayMinutes, classifyServiceType, collapseDuplicateBoardRows } from "./board-build.js";

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

test("collapses next-day Darwin twin next to today's live row", () => {
  const rows = collapseDuplicateBoardRows([
    {
      rid: "202610027115900",
      trainId: "9M13",
      destinationCrs: "LIV",
      destinationName: "Liverpool Lime Street",
      originCrs: "NCL",
      isPassing: true,
      movement: "departure",
      scheduledTime: "14:40",
      scheduledAt: "2026-10-02T14:40:00.000Z",
      liveKind: "working",
      unitIds: ["802215"],
    },
    {
      rid: "202610037115918",
      trainId: "9M13",
      destinationCrs: null,
      destinationName: null,
      originCrs: null,
      isPassing: true,
      movement: "departure",
      scheduledTime: "14:42",
      scheduledAt: "2026-10-02T14:42:00.000Z",
      liveKind: "scheduled",
      unitIds: null,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rid, "202610027115900");
  assert.equal(rows[0].scheduledTime, "14:40");
});

test("departure movement keeps actual-arr while at platform", async () => {
  const { liveClockFromCall } = await import("./board-build.js");
  assert.deepEqual(
    liveClockFromCall({ ata: "17:13", etd: "17:13" }, "departure"),
    { time: "17:13", kind: "actual-arr" },
  );
  assert.deepEqual(
    liveClockFromCall({ ata: "17:13", atd: "17:15", etd: "17:13" }, "departure"),
    { time: "17:15", kind: "actual" },
  );
});
