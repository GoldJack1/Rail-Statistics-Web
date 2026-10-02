import { test } from "node:test";
import assert from "node:assert/strict";
import { collapseCallsByTiploc, sortCallsByJourneyTime } from "./journey-order.js";

test("orders a same-evening run from first time to last", () => {
  const rows = [
    { tiploc: "SCA", seq: 1, sta: "23:16" },
    { tiploc: "MIR", seq: 40, wtp: "21:23" },
    { tiploc: "MLT", seq: 2, std: "22:52" },
    { tiploc: "COT", seq: 41, wtp: "21:35" },
  ];
  assert.deepEqual(
    sortCallsByJourneyTime(rows).map((r) => r.tiploc),
    ["MIR", "COT", "MLT", "SCA"],
  );
});

test("keeps overnight services in running order", () => {
  const rows = [
    { tiploc: "PAD", seq: 9, std: "23:50" },
    { tiploc: "RDG", seq: 0, wtp: "00:20" },
    { tiploc: "OXF", seq: 1, sta: "00:45" },
  ];
  assert.deepEqual(
    sortCallsByJourneyTime(rows).map((r) => r.tiploc),
    ["PAD", "RDG", "OXF"],
  );
});

test("post-midnight public stops stay after evening stops on the railway day", () => {
  const rows = [
    { tiploc: "LIVST", crs: "LIV", seq: 0, std: "21:49" },
    { tiploc: "LEEDS", crs: "LDS", seq: 1, sta: "23:56" },
    { tiploc: "YORK", crs: "YRK", seq: 2, sta: "00:35" },
  ];
  assert.deepEqual(
    sortCallsByJourneyTime(rows).map((r) => r.crs),
    ["LIV", "LDS", "YRK"],
  );
});

test("keeps a sleeper in order past 02:00", () => {
  const rows = [
    { tiploc: "EUS", seq: 0, std: "21:15" },
    { tiploc: "PRE", seq: 1, sta: "00:30" },
    { tiploc: "EDB", seq: 2, sta: "04:40" },
    { tiploc: "INV", seq: 3, sta: "08:37" },
  ];
  assert.deepEqual(
    sortCallsByJourneyTime(rows).map((r) => r.tiploc),
    ["EUS", "PRE", "EDB", "INV"],
  );
});

test("orders a short afternoon service 10:00 to 12:00", () => {
  const rows = [
    { tiploc: "B", seq: 0, std: "11:00" },
    { tiploc: "C", seq: 2, sta: "12:00" },
    { tiploc: "A", seq: 9, std: "10:00" },
  ];
  assert.deepEqual(
    sortCallsByJourneyTime(rows).map((r) => r.tiploc),
    ["A", "B", "C"],
  );
});

test("collapses the same TIPLOC copied from an adjacent day file", () => {
  const rows = [
    { tiploc: "EUS", seq: 0, std: "21:15" },
    { tiploc: "EDB", seq: 80, sta: "04:40", std: "04:52" },
    { tiploc: "INV", seq: 119, sta: "08:45" },
    { tiploc: "EUS", seq: 0, std: "21:15", ata: "21:16" },
    { tiploc: "EDB", seq: 80, sta: "04:40", std: "04:52" },
    { tiploc: "INV", seq: 119, sta: "08:45" },
  ];
  assert.deepEqual(
    collapseCallsByTiploc(rows).map((r) => r.tiploc),
    ["EUS", "EDB", "INV"],
  );
  assert.equal(collapseCallsByTiploc(rows)[0].ata, "21:16");
});
