import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cifBsRunsOn,
  cifImportDayYmds,
  cifWeekdayIndex,
  mergeDarwinCallsWithCifPasses,
  parseCifBxAtoc,
  parseCifLocation,
} from "./cif-schedule.js";

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

test("CIF working timetable fills Darwin when public stops match", () => {
  const darwin = [
    { tiploc: "LEEDS", seq: 0, std: "10:00", is_passing: 0 },
    { tiploc: "LEEDSWJ", seq: 1, is_passing: 1, wtp: "10:01" },
    { tiploc: "WHRDJN", seq: 2, is_passing: 1, wtp: "10:02" },
    { tiploc: "MRLY", seq: 3, is_passing: 1, wtp: "10:06" },
    { tiploc: "DWBY", seq: 4, sta: "10:10", std: "10:11", is_passing: 0 },
  ];
  const cif = [
    { tiploc: "LEEDS" },
    { tiploc: "LEEDSWJ" },
    { tiploc: "HOLBJCN", passing: true, wtp: "10:01" },
    { tiploc: "WHRDJN" },
    { tiploc: "COTNGLY", passing: true, wtp: "10:04" },
    { tiploc: "MRLY" },
    { tiploc: "BATLEY", passing: true, wtp: "10:08" },
    { tiploc: "DWBY" },
  ];
  const tpls = mergeDarwinCallsWithCifPasses(darwin, cif).map((c) => c.tiploc);
  assert.deepEqual(tpls, ["LEEDS", "LEEDSWJ", "HOLBJCN", "WHRDJN", "COTNGLY", "MRLY", "BATLEY", "DWBY"]);
});

test("full CIF merge prefers ITPS working times over stale Darwin wtp", () => {
  const darwin = [
    { tiploc: "REDCARC", seq: 0, std: "15:56", atd: "15:56" },
    { tiploc: "STHBANK", seq: 1, is_passing: 1, wtp: "04:07", atp: "16:02" },
    { tiploc: "MDLSBRO", seq: 2, sta: "16:09", std: "16:11" },
  ];
  const cif = [
    { tiploc: "REDCARC", wtd: "15:56" },
    { tiploc: "STHBANK", passing: true, wtp: "16:04" },
    { tiploc: "MDLSBRO", wta: "16:09", wtd: "16:11" },
  ];
  const merged = mergeDarwinCallsWithCifPasses(darwin, cif);
  assert.equal(merged.find((c) => c.tiploc === "STHBANK")?.wtp, "16:04");
  assert.equal(merged.find((c) => c.tiploc === "STHBANK")?.atp, "16:02");
});

test("CIF does not reinsert a public stop Darwin omitted (Huddersfield diversion)", () => {
  const darwin = [
    { tiploc: "LEEDS", seq: 0 },
    { tiploc: "LEEDSWJ", seq: 1 },
    { tiploc: "WHRDJN", seq: 2 },
    { tiploc: "MRLY", seq: 3 },
    { tiploc: "DWBY", seq: 4 },
  ];
  const cif = [
    { tiploc: "LEEDS" },
    { tiploc: "LEEDSWJ" },
    { tiploc: "HOLBJCN", passing: true, wtp: "10:01" },
    { tiploc: "WHRDJN" },
    { tiploc: "HDRSFLD", pta: "10:12", ptd: "10:14" },
    { tiploc: "DWBY" },
  ];
  const tpls = mergeDarwinCallsWithCifPasses(darwin, cif).map((c) => c.tiploc);
  assert.deepEqual(tpls, ["LEEDS", "LEEDSWJ", "HOLBJCN", "WHRDJN", "MRLY", "DWBY"]);
  assert.equal(tpls.includes("HDRSFLD"), false);
});
