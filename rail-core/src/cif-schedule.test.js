import { test } from "node:test";
import assert from "node:assert/strict";
import { cifBsRunsOn, cifImportDayYmds, cifWeekdayIndex, parseCifBxAtoc, parseCifLocation } from "./cif-schedule.js";

function bs({ days = "0000100", stp = "P", txn = "N" } = {}) {
  return (`BS${txn}UID001260518261207${days} PXX1S25`).padEnd(79, " ") + stp;
}

test("CIF import skips Darwin’s operating day", () => {
  assert.deepEqual(cifImportDayYmds("2026-10-03", 2, "2026-10-03"), ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(cifImportDayYmds("2026-10-04", 1, "2026-10-03"), ["2026-10-04", "2026-10-05"]);
});

test("CIF weekday index is Mon=0", () => {
  assert.equal(cifWeekdayIndex("2026-10-02"), 4);
});

test("CIF BS runs on matching day-of-week inside the date range", () => {
  const line = bs();
  assert.equal(cifBsRunsOn(line, "2026-10-02"), true);
  assert.equal(cifBsRunsOn(line, "2026-10-01"), false);
  assert.equal(cifBsRunsOn(line, "2026-05-17"), false);
});

test("CIF BS skips cancellations and deletes", () => {
  const cancel = bs({ days: "1111111", stp: "C" });
  const del = bs({ days: "1111111", txn: "D" });
  assert.equal(cifBsRunsOn(cancel, "2026-10-02"), false);
  assert.equal(cifBsRunsOn(del, "2026-10-02"), false);
});

test("BX ATOC is columns 12-13", () => {
  const line = (`BX${" ".repeat(9)}NT`).padEnd(80, " ");
  assert.equal(parseCifBxAtoc(line), "NT");
});

test("CIF public 0000 is not a passenger time", () => {
  let line = "LI".padEnd(80, " ");
  const chars = line.split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(2, "LEEDSWJ ");
  put(20, "18025");
  put(25, "0000");
  put(29, "0000");
  const loc = parseCifLocation("LI", chars.join(""));
  assert.equal(loc.tiploc, "LEEDSWJ");
  assert.equal(loc.wtp, "18:02");
  assert.equal(loc.pta, null);
  assert.equal(loc.ptd, null);
  assert.equal(loc.passing, true);
});

test("LI public times and platform", () => {
  let line = "LI".padEnd(80, " ");
  line = `LI${"WKFLDWG "}`.padEnd(80, " ");
  const chars = line.split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(10, "19180");
  put(15, "19205");
  put(25, "1918");
  put(29, "1920");
  put(33, "1  ");
  const loc = parseCifLocation("LI", chars.join(""));
  assert.equal(loc.tiploc, "WKFLDWG");
  assert.equal(loc.wta, "19:18");
  assert.equal(loc.wtd, "19:20");
  assert.equal(loc.pta, "19:18");
  assert.equal(loc.ptd, "19:20");
  assert.equal(loc.platform, "1");
  assert.equal(loc.passing, false);
});
