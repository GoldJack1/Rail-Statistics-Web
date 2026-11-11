import assert from "node:assert/strict";
import test from "node:test";
import { chooseLeftHandRoads, leftBearing, leftHandRoad, roadRequests } from "./left-hand-road.js";

const stand = (lat, lng) => ({ lat, lng, ends: [[lat, lng], [lat, lng]], stand: [lat, lng] });
const NORTHALLERTON = { lat: 54.3330789, lng: -1.441275691 };
const P1 = stand(54.332818, -1.441544);
const P2 = stand(54.333232, -1.441844);

test("a left@ platform carries the bearing and other platforms do not", () => {
  assert.equal(leftBearing("left@340"), 340);
  assert.equal(leftBearing("LEFT@-20"), 340);
  assert.equal(leftBearing("2"), null);
  assert.equal(leftBearing("*"), null);
});

test("a northbound call at Northallerton takes platform 2 and a southbound call platform 1", () => {
  assert.equal(leftHandRoad(NORTHALLERTON, 340, [P1, P2]), P2);
  assert.equal(leftHandRoad(NORTHALLERTON, 160, [P1, P2]), P1);
  assert.equal(leftHandRoad(NORTHALLERTON, 340, [P1]), P1);
  assert.equal(leftHandRoad(NORTHALLERTON, 340, []), null);
});

test("a platform well off the line of travel is not the through pair", () => {
  const far = stand(54.3330789, -1.4445);
  assert.equal(leftHandRoad(NORTHALLERTON, 340, [P1, P2, far]), P2);
});

test("the roads fetched for a left@ request become one guessed platform", () => {
  const requests = [
    { id: "52", ...NORTHALLERTON, platform: "left@340" },
    { id: "53", lat: 54.49, lng: -1.35, platform: "1" },
  ];
  assert.deepEqual(roadRequests(requests), [
    { id: "52~left", ...NORTHALLERTON, platform: "*" },
    requests[1],
  ]);
  const yarm = stand(54.49, -1.35);
  const coords = chooseLeftHandRoads({ "52~left~1": P1, "52~left~2": P2, "53": yarm }, requests);
  assert.deepEqual(coords, { "52": { ...P2, guess: true }, "53": yarm });
});
