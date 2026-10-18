import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cifBsRunsOn,
  cifImportDayYmds,
  cifWeekdayIndex,
  darwinScheduleAnchors,
  mergeDarwinCallsWithCifPasses,
  parseCifBxAtoc,
  parseCifBsProfile,
  parseCifBsStock,
  parseCifChange,
  parseCifLocation,
  parseCifTime,
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

test("CIF working times keep half-minutes", () => {
  assert.equal(parseCifTime("1302H"), "13:02½");
  assert.equal(parseCifTime("1302"), "13:02");
});

test("LI path and line and half-minute pass", () => {
  const chars = "LI".padEnd(80, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(2, "LOWFLLJ ");
  put(20, "1302H");
  put(36, "UM ");
  put(39, "UF ");
  const loc = parseCifLocation("LI", chars.join(""));
  assert.equal(loc.wtp, "13:02½");
  assert.equal(loc.line, "UM");
  assert.equal(loc.path, "UF");
});

test("LI pathing allowance is half-minutes", () => {
  const chars = "LI".padEnd(80, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(2, "APPERLYJ");
  put(20, "1240 ");
  put(46, "02");
  const loc = parseCifLocation("LI", chars.join(""));
  assert.equal(loc.pathingAllowance, "02");
  assert.equal(loc.engineeringAllowance, null);
});

test("CIF BS profile reads the service code, dates and speed", () => {
  const chars = "BS".padEnd(80, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(3, "C32529");
  put(9, "260517");
  put(15, "261206");
  put(21, "0000001");
  put(29, "P");
  put(30, "OO");
  put(32, "2H58");
  put(36, "5908");
  put(41, "21869000");
  put(50, "DMU");
  put(53, "150 ");
  put(57, "075");
  put(66, "S");
  put(68, "A");
  const profile = parseCifBsProfile(chars.join(""));
  assert.equal(profile.identity, "2H58");
  assert.equal(profile.headcode, "5908");
  assert.equal(profile.tsc, "21869000");
  assert.equal(profile.runsFrom, "2026-05-17");
  assert.equal(profile.runsTo, "2026-12-06");
  assert.equal(profile.daysRun, "0000001");
  assert.equal(profile.seating, "S");
  assert.equal(profile.reservations, "A");
  assert.equal(profile.speed, "75");
});

test("CIF change en route carries the new timing load", () => {
  const chars = "CR".padEnd(70, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(2, "SHIPLEY ");
  put(30, "DMU");
  put(33, "158 ");
  put(37, "090");
  const change = parseCifChange(chars.join(""));
  assert.equal(change.tiploc, "SHIPLEY");
  assert.equal(change.powerType, "DMU");
  assert.equal(change.timingLoad, "158");
  assert.equal(change.speed, "90");
});

test("CIF BS stock fields", () => {
  const chars = "BS".padEnd(80, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(46, "EMU");
  put(49, "321 ");
  const stock = parseCifBsStock(chars.join(""));
  assert.equal(stock.powerType, "EMU");
  assert.equal(stock.timingLoad, "321");
});

test("CIF BS stock treats 000 + EMU800 as Azuma power/timing", () => {
  const chars = "BS".padEnd(90, " ").split("");
  const put = (from, text) => {
    for (let i = 0; i < text.length; i++) chars[from + i] = text[i];
  };
  put(46, "000 EMU800 125");
  const stock = parseCifBsStock(chars.join(""));
  assert.equal(stock.powerType, "EMU");
  assert.equal(stock.timingLoad, "800");
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
  assert.equal(merged.find((c) => c.tiploc === "REDCARC")?.wtd, "15:56");
});

test("CIF between-anchor merge stamps path/line onto Darwin stops", () => {
  const darwin = [
    { tiploc: "LEEDS", seq: 0, std: "10:00", is_passing: 0 },
    { tiploc: "DWBY", seq: 1, sta: "10:10", is_passing: 0 },
  ];
  const cif = [
    { tiploc: "LEEDS", wtd: "10:00", line: "F" },
    { tiploc: "HOLBJCN", passing: true, wtp: "10:01", path: "SL" },
    { tiploc: "DWBY", wta: "10:10", path: "A" },
  ];
  const merged = mergeDarwinCallsWithCifPasses(darwin, cif);
  assert.equal(merged.find((c) => c.tiploc === "LEEDS")?.line, "F");
  assert.equal(merged.find((c) => c.tiploc === "DWBY")?.path, "A");
  assert.equal(merged.find((c) => c.tiploc === "HOLBJCN")?.wtp, "10:01");
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

test("CIF between-anchor still inserts passes when a public extra is skipped", () => {
  const darwin = [
    { tiploc: "NWTNLW", seq: 0, std: "16:10", is_passing: 0 },
    { tiploc: "LVRPLSH", seq: 1, sta: "16:40", is_passing: 0 },
  ];
  const cif = [
    { tiploc: "NWTNLW", ptd: "16:10", wtd: "16:10" },
    { tiploc: "HUYTON", passing: true, wtp: "16:20" },
    { tiploc: "LEGR", pta: "16:15", ptd: "16:16" },
    { tiploc: "EDGH", passing: true, wtp: "16:28" },
    { tiploc: "LVRPLSH", pta: "16:40", wta: "16:40" },
  ];
  const tpls = mergeDarwinCallsWithCifPasses(darwin, cif).map((c) => c.tiploc);
  assert.deepEqual(tpls, ["NWTNLW", "HUYTON", "EDGH", "LVRPLSH"]);
});

test("Darwin anchors keep 3-letter CRS pass stations", () => {
  const calls = [
    { tiploc: "YORK", sta: "14:00", is_passing: 0, crs: "YRK" },
    { tiploc: "EGRFRTH", is_passing: 1, crs: "EGF", actual_source: "orm" },
    { tiploc: "HOLBJCN", is_passing: 1, crs: null },
    { tiploc: "LEEDS", sta: "14:30", is_passing: 0, crs: "LDS" },
  ];
  assert.deepEqual(
    darwinScheduleAnchors(calls).map((c) => c.tiploc),
    ["YORK", "EGRFRTH", "LEEDS"],
  );
});
