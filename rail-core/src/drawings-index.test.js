import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLookup, drawingCandidateIds, drawingsForTrain, expandUnitRange, resolveDrawings } from "./drawings-index.js";

const index = {
  version: "t",
  drawings: [
    { id: "67/mk4/tfw/exlner", toc: ["AW"], units: ["67008"], classes: ["67"], width: 1553.18, height: 40 },
    { id: "67/mk4/tfw/black", toc: ["AW"], units: ["67012", "67016"], classes: [], width: 1553.18, height: 40 },
    { id: "68/mk5/chiltern/mk5", toc: ["CH"], units: expandUnitRange("68019-68032"), classes: [], width: 1318.4, height: 40 },
    { id: "139/std/wmr/std", toc: ["WM"], units: [], classes: ["139"], width: 110.61, height: 40 },
  ],
};
const lookup = buildLookup(index);
const ids = (toc, list) => resolveDrawings(lookup, toc, list).map((d) => d.id);

test("expands ranges", () => {
  assert.equal(expandUnitRange("68019-68032").length, 14);
  assert.deepEqual(expandUnitRange("67008"), ["67008"]);
  assert.throws(() => expandUnitRange("68032-68019"));
});

test("explicit loco number wins over the class-wide livery", () => {
  assert.deepEqual(ids("AW", ["67012"]), ["67/mk4/tfw/black"]);
  assert.deepEqual(ids("AW", ["67008"]), ["67/mk4/tfw/exlner"]);
});

test("a TfW 67 not on any list falls back to ex-LNER", () => {
  assert.deepEqual(ids("AW", ["67099"]), ["67/mk4/tfw/exlner"]);
});

test("a 67 for another operator gets nothing", () => {
  assert.deepEqual(ids("GW", ["67008"]), []);
});

test("68 only inside its range and for Chiltern", () => {
  assert.deepEqual(ids("CH", ["68019"]), ["68/mk5/chiltern/mk5"]);
  assert.deepEqual(ids("CH", ["68018"]), []);
  assert.deepEqual(ids("AW", ["68020"]), []);
});

test("139 by class for WMR only", () => {
  assert.deepEqual(ids("WM", ["139001"]), ["139/std/wmr/std"]);
  assert.deepEqual(ids("XC", ["139001"]), []);
});

test("unlisted units and no index give no drawing", () => {
  assert.deepEqual(ids("AW", ["175001", "CH01"]), []);
  assert.deepEqual(resolveDrawings(null, "AW", ["67008"]), []);
});

test("candidates take loco numbers from vehicles and honour onlyUnits", () => {
  const consist = {
    allocations: [
      { resourceGroups: [{ unitId: "TW01", vehicles: [{ vehicleId: "67008" }, { vehicleId: "11111" }] }, { unitId: "OTHER", vehicles: [{ vehicleId: "67012" }] }] },
    ],
  };
  assert.deepEqual(drawingCandidateIds(consist), ["TW01", "67008", "11111", "OTHER", "67012"]);
  assert.deepEqual(drawingsForTrain("AW", consist, { onlyUnits: ["TW01"], lookup }).map((d) => d.id), ["67/mk4/tfw/exlner"]);
});
