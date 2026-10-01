import assert from "node:assert/strict";
import test from "node:test";
import { parseLoadingXml } from "./darwin-xml.js";

test("parses overall and per-coach Darwin loading", () => {
  const parsed = parseLoadingXml(
    "",
    `<loading loadingPercentage="42"/><formationLoading coachNumber="A" loading="3"/><formationLoading coachNumber="B" loading="8"/>`,
  );
  assert.equal(parsed.loading_percentage, 42);
  assert.deepEqual(JSON.parse(parsed.coach_loading), [
    { number: "A", value: 3 },
    { number: "B", value: 8 },
  ]);
});
