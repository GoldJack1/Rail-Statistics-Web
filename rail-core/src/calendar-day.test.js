import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  callCalendarYmd,
  callOnBoardDate,
  darwinWriteDays,
  locationBoardDays,
  londonCalendarYmd,
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
