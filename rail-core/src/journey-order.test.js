import { test } from "node:test";
import assert from "node:assert/strict";
import { sortCallsByJourneyTime } from "./journey-order.js";

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
