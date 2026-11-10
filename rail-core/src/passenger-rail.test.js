import assert from "node:assert/strict";
import { test } from "node:test";
import { graphLegGoesBackwards, passengerRailFile, routePassengerJourney } from "./passenger-rail.js";

test("a leg that leaves backwards is recognised", () => {
  const from = [53.724, -1.355];
  const to = [53.827, -1.228];
  const away = [from, [53.73, -1.4], [53.76, -1.5], [53.79, -1.55], [53.8, -1.4], [53.81, -1.3], to];
  assert.equal(graphLegGoesBackwards(away, from, to), true);
  const onward = [from, [53.76, -1.3], [53.8, -1.25], to];
  assert.equal(graphLegGoesBackwards(onward, from, to), false);
});

test("Castleford stays on the line through Sherburn", async () => {
  if (!passengerRailFile()) return;
  const segments = await routePassengerJourney([
    [53.72408, -1.35465],
    [53.8266, -1.22759],
  ]);
  assert.ok(segments.length >= 1);
  const points = segments.flat();
  assert.ok(Math.min(...points.map((point) => point[1])) > -1.37);
  assert.ok(points.some((point) => point[0] > 53.79 && point[0] < 53.82 && point[1] > -1.25));
});
