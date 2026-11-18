import { test } from "node:test";
import assert from "node:assert/strict";
import { tocDisplayName } from "./toc-names.js";

test("LM splits into LNWR and WMR by the ends of the run", () => {
  assert.equal(tocDisplayName("LM", { originCrs: "EUS", destCrs: "NMP" }), "London Northwestern Railway");
  assert.equal(tocDisplayName("LM", { originCrs: "BHM", destCrs: "CRE" }), "London Northwestern Railway");
  assert.equal(tocDisplayName("LM", { originCrs: "BHM", destCrs: "HFD" }), "West Midlands Railway");
  assert.equal(tocDisplayName("LM"), "West Midlands Railway");
  assert.equal(tocDisplayName("GW"), "Great Western Railway");
});
