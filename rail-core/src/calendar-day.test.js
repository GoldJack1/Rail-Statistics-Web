import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  callCalendarYmd,
  callOnBoardDate,
  darwinWriteDays,
  isOvernightSleeperJourney,
  locationBoardDays,
  londonCalendarYmd,
  ridVisibleOnBoard,
  ssdFromRid,
} from "./calendar-day.js";

test("ssdFromRid reads Darwin prefix", () => {
  assert.equal(ssdFromRid("202610018024061"), "2026-10-01");
  assert.equal(ssdFromRid("bad"), null);
});

test("location boards merge previous SSD file", () => {
  assert.deepEqual(locationBoardDays("2026-10-01"), ["2026-09-30", "2026-10-01"]);
});

test("tomorrow's Darwin rid still overlays a timetable stored on today", () => {
  const has = (day) => day === "2026-10-01";
  assert.deepEqual(darwinWriteDays("2026-10-01", "2026-10-02", has).sort(), ["2026-10-01", "2026-10-02"]);
});

test("a tomorrow-only rid is not copied onto today", () => {
  assert.deepEqual(darwinWriteDays("2026-10-01", "2026-10-02", () => false), ["2026-10-02"]);
});

test("next-day afternoon Darwin rids stay off today's board", () => {
  assert.equal(ridVisibleOnBoard("202610037115918", "14:42", "2026-10-02"), false);
  assert.equal(ridVisibleOnBoard("202610027115900", "14:40", "2026-10-02"), true);
  assert.equal(ridVisibleOnBoard("202610030000001", "01:15", "2026-10-02"), true);
});

test("last night's sleeper origin is not tonight's 21:15 after railway-day changeover", () => {
  const cs = { overnightSleeper: true };
  assert.equal(ridVisibleOnBoard("202610016704570", "21:15", "2026-10-02", cs), false);
  assert.equal(ridVisibleOnBoard("202610016704570", "04:40", "2026-10-02", cs), true);
  assert.equal(ridVisibleOnBoard("202610026704570", "21:15", "2026-10-02", cs), true);
  const gw = { overnightSleeper: true };
  assert.equal(ridVisibleOnBoard("202610011234567", "23:45", "2026-10-02", gw), false);
  assert.equal(ridVisibleOnBoard("202610011234567", "08:15", "2026-10-02", gw), true);
});

test("GWR sleeper is the overnight pattern, not a particular headcode", () => {
  assert.equal(isOvernightSleeperJourney("CS", "XX", 21 * 60 + 15, 8 * 60 + 45), true);
  assert.equal(isOvernightSleeperJourney("GW", "SL", null, null), true);
  assert.equal(isOvernightSleeperJourney("GW", "XX", 23 * 60 + 45, 8 * 60 + 15), true);
  assert.equal(isOvernightSleeperJourney("GW", "XX", 21 * 60 + 45, 5 * 60 + 8), true);
  assert.equal(isOvernightSleeperJourney("GW", "XX", 22 * 60 + 30, 3), false);
  assert.equal(isOvernightSleeperJourney("GW", "XX", 21 * 60, 22 * 60 + 30), false);
  assert.equal(isOvernightSleeperJourney("GW", "XX", 18 * 60, 21 * 60), false);
});

test("overnight 00:00–01:59 stays on the Darwin SSD railway day", () => {
  assert.equal(callCalendarYmd("2026-09-30", "01:30"), "2026-10-01");
  assert.equal(callOnBoardDate("2026-10-01", "01:30", "2026-10-01"), true);
  assert.equal(callOnBoardDate("2026-09-30", "01:30", "2026-10-01"), false);
  assert.equal(callOnBoardDate("2026-09-30", "23:50", "2026-10-01"), false);
  assert.equal(callOnBoardDate("2026-10-01", "02:00", "2026-10-01"), true);
});

test("london calendar is midnight not 02:00", () => {
  const early = new Date("2026-10-01T00:30:00+01:00");
  assert.equal(londonCalendarYmd(early), "2026-10-01");
  const beforeMidnight = new Date("2026-09-30T23:30:00+01:00");
  assert.equal(londonCalendarYmd(beforeMidnight), "2026-09-30");
});

test("addCalendarDays crosses months", () => {
  assert.equal(addCalendarDays("2026-09-30", 1), "2026-10-01");
});
