import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTiplocName } from "./tiploc-names.js";

const hints = [
  { tiploc: "LEEDS", name: "Leeds" },
  { tiploc: "APERLYB", name: "Apperley Bridge" },
  { tiploc: "SHPY", name: "Shipley" },
];

test("does not rename Menston to Otley via a shared prefix", () => {
  const menstonHints = [
    { tiploc: "MENSTON", name: "Menston" },
    { tiploc: "MENSTOB", name: "Otley (Bus Station)" },
  ];
  assert.equal(formatTiplocName("MENSTON", "Menston", menstonHints), "Menston");
  assert.equal(formatTiplocName("MENSTON", null, menstonHints), "Menston");
  assert.equal(formatTiplocName("MENSTOB", "Otley (Bus Station)", menstonHints), "Otley (Bus Station)");
});

test("formats junction tiplocs", () => {
  assert.equal(formatTiplocName("LEEDSWJ", null, hints), "Leeds West Junction");
  assert.equal(formatTiplocName("ARMLJCN", null, hints), "Armley Junction");
  assert.equal(formatTiplocName("APERLYJ", null, hints), "Apperley Junction");
  assert.equal(formatTiplocName("SHPYDJN", null, hints), "Shipley Junction");
  assert.equal(formatTiplocName("LEEDSWJ", "Leeds West Junction"), "Leeds West Junction");
  assert.equal(formatTiplocName("LEEDS", "Leeds"), "Leeds");
  assert.equal(formatTiplocName("YORK", "York"), "York");
});
