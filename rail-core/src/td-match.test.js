import assert from "node:assert/strict";
import test from "node:test";
import { namedPointsFromTdSteps } from "./td-match.js";

// One headcode, three workings. Only the middle one is Leeds to Bradford.
const steps = [
  { msgType: "CA", berth: "C081", tiploc: "", name: "", receivedAt: 1 },
  { msgType: "CA", berth: "0499", tiploc: "NRCH", name: "Norwich", crs: "NRW", receivedAt: 2 },
  { msgType: "CB", berth: "NYAP", tiploc: "LEEDS", name: "Leeds", crs: "LDS", receivedAt: 100 },
  { msgType: "CA", berth: "DUMY", tiploc: "LEEDS", name: "Leeds", crs: "LDS", receivedAt: 105 },
  { msgType: "CA", berth: "0001", tiploc: "LEEDS", name: "Leeds", crs: "LDS", receivedAt: 110 },
  { msgType: "CA", berth: "0056", tiploc: "", name: "", receivedAt: 115 },
  { msgType: "CA", berth: "0003", tiploc: "COTNGLY", name: "Cottingley", crs: "COT", receivedAt: 120 },
  { msgType: "CA", berth: "0004", tiploc: "COTNGLY", name: "Cottingley", crs: "COT", receivedAt: 121 },
  { msgType: "CC", berth: "0005", tiploc: "MRLY", name: "Morley", crs: "MLY", receivedAt: 130 },
  { msgType: "CA", berth: "0006", tiploc: "HLFX", name: "Halifax", crs: "HFX", receivedAt: 140 },
  { msgType: "CA", berth: "0007", tiploc: "BRADIN", name: "Bradford Interchange", crs: "BDI", receivedAt: 150 },
  { msgType: "CA", berth: "0008", tiploc: "GRVPK", name: "Grove Park", crs: "GRP", receivedAt: 400 },
];

test("a describer trace keeps named places for this working and drops bare signals", () => {
  const points = namedPointsFromTdSteps(steps, { fromMs: 100, toMs: 200 });
  assert.deepEqual(
    points.map((point) => point.name),
    ["Leeds", "Cottingley", "Morley", "Halifax", "Bradford Interchange"],
  );
  assert.equal(points[1].crs, "COT");
  assert.equal(points.some((point) => point.name === "Norwich"), false);
  assert.equal(points.some((point) => point.name === "Grove Park"), false);
});

test("without a time window every working of the headcode is included", () => {
  const points = namedPointsFromTdSteps(steps);
  assert.deepEqual(
    points.map((point) => point.tiploc),
    ["NRCH", "LEEDS", "COTNGLY", "MRLY", "HLFX", "BRADIN", "GRVPK"],
  );
});
