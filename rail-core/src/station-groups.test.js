import assert from "node:assert/strict";
import test from "node:test";
import { stationCrsGroup, tiplocsForStation } from "./station-groups.js";

test("Farringdon combines Thameslink and Elizabeth line codes", () => {
  const map = {
    ZFD: ["FRNDNLT", "FNTLSR"],
    FDX: ["FRNDXR"],
  };
  const merged = tiplocsForStation("ZFD", (crs) => map[crs] || []);
  assert.deepEqual(merged.group, ["ZFD", "FDX"]);
  assert.deepEqual(new Set(merged.tiplocs), new Set(["FRNDNLT", "FNTLSR", "FRNDXR"]));
  const fromElizabeth = tiplocsForStation("FDX", (crs) => map[crs] || []);
  assert.deepEqual(new Set(fromElizabeth.tiplocs), new Set(merged.tiplocs));
});

test("St Pancras keeps domestic, international, and Thameslink together", () => {
  assert.deepEqual(stationCrsGroup("SPL"), ["STP", "SPX", "SPL"]);
});

test("Glasgow and London Charing Cross are not a pair", () => {
  assert.equal(stationCrsGroup("CHC"), null);
  assert.equal(stationCrsGroup("CHX"), null);
});

test("unrelated stations stay alone", () => {
  assert.equal(stationCrsGroup("KGX"), null);
  const merged = tiplocsForStation("KGX", () => ["KNGX"]);
  assert.deepEqual(merged.tiplocs, ["KNGX"]);
});
