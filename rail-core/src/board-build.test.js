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

test("collapses CIF and Darwin rows that share a UID", () => {
  const rows = collapseDuplicateBoardRows([
    {
      rid: "20261003G15982",
      uid: "G15982",
      trainId: "1P83",
      destinationCrs: "SLB",
      isPassing: false,
      movement: "departure",
      scheduledTime: "18:01",
      scheduledAt: "2026-10-03T18:01:00.000Z",
      liveKind: "scheduled",
    },
    {
      rid: "202610037115982",
      uid: "G15982",
      trainId: "1P83",
      destinationCrs: "SLB",
      toc: "TP",
      isPassing: false,
      movement: "departure",
      scheduledTime: "18:01",
      scheduledAt: "2026-10-03T18:01:00.000Z",
      liveKind: "est",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rid, "202610037115982");
});

test("ORM passing inserts are excluded from station boards", async () => {
  const { buildStationBoard } = await import("./board-build.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openDayDb, upsertCall, upsertService } = await import("./db.js");

  const dir = mkdtempSync(join(tmpdir(), "board-orm-"));
  const db = openDayDb(dir, "2026-10-05");
  upsertService(db, {
    rid: "202610058734291",
    uid: "W34291",
    train_id: "9S93",
    rs_id: null,
    toc: "VT",
    operator_name: "Avanti",
    origin_crs: "EUS",
    origin_name: "London Euston",
    destination_crs: "EDB",
    destination_name: "Edinburgh",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: null,
    headcode: "9S93",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "202610058734291",
    tiploc: "LEEDS",
    crs: "LDS",
    seq: 0,
    is_passing: 0,
    cancelled: 0,
    std: "21:00",
    live_kind: "scheduled",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "202610058734291",
    tiploc: "DWBY",
    crs: "DEW",
    seq: 1,
    is_passing: 1,
    cancelled: 0,
    wtp: "22:21",
    live_kind: "scheduled",
    actual_source: "orm",
    updated_at: 1,
  });
  const board = buildStationBoard({
    db,
    ymd: "2026-10-05",
    crs: "DEW",
    tiplocs: ["DWBY"],
    hours: 6,
    now: new Date("2026-10-05T20:00:00+01:00"),
    passengersOnly: false,
    stationName: (crs) => (crs === "DEW" ? "Dewsbury" : crs),
    matchBy: "crs",
    fullDay: false,
  });
  assert.equal(
    board.departures.find((d) => d.trainId === "9S93"),
    undefined,
  );
  db.close();
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
