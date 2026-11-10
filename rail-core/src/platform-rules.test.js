import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("a stand fix replaces that platform and a missing rules file stays empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "platform-rules-"));
  const fixes = join(dir, "fixes.json");
  writeFileSync(fixes, JSON.stringify({
    stands: [{ near: [53.8, -1.5], withinM: 800, ref: "3", lat: 53.81, lng: -1.51 }],
  }));
  process.env.PLATFORM_FIXES_PATH = fixes;
  process.env.PLATFORM_RULES_PATH = join(dir, "absent.json");
  const mod = await import(`./platform-rules.js?case=${Date.now()}`);
  assert.equal(mod.readPlatformRules(), null);
  const coords = { "2": { lat: 53.8, lng: -1.5, ends: [[53.8, -1.5], [53.8, -1.5]] } };
  mod.applyPlatformFixes(coords, [{ id: "2", lat: 53.8, lng: -1.5, platform: "3" }]);
  assert.equal(coords["2"].lat, 53.81);
  assert.deepEqual(coords["2"].stand, [53.81, -1.51]);

  process.env.PLATFORM_FIXES_PATH = join(dirname(fileURLToPath(import.meta.url)), "../config/platform-fixes.json");
  const live = await import(`./platform-rules.js?huddersfield=${Date.now()}`);
  const huddersfield = {
    "roads~1": { lat: 53.64833, lng: -1.784869 },
    "roads~4A": { lat: 53.649052, lng: -1.784395 },
  };
  const here = { lat: 53.64843, lng: -1.78515 };
  live.applyPlatformFixes(huddersfield, [
    { id: "booked1", ...here, platform: "1" },
    { id: "booked4", ...here, platform: "4" },
    { id: "roads", ...here, platform: "*" },
  ]);
  assert.equal(huddersfield.booked1.lat, 53.647739);
  assert.equal(huddersfield.booked4.lat, 53.649021);
  assert.equal(huddersfield["roads~4A"], undefined);
  assert.deepEqual(huddersfield["roads~1"].stand, [53.647739, -1.785214]);
  assert.equal(huddersfield["roads~3"].lng, -1.784417);
});
