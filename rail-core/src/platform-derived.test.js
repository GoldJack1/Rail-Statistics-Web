import assert from "node:assert/strict";
import test from "node:test";
import { derivedTracksAt } from "./platform-derived.js";

const stations = [
  { crs: "WDS", lat: 53.75679, lng: -1.44288, tracks: [{ ref: "1", lat: 53.7568, lng: -1.4429 }, { ref: "2", lat: 53.75681, lng: -1.44285 }] },
  { crs: "AAA", lat: 51.5, lng: -0.1, tracks: [] },
];

test("the nearest station's derived platforms are written as quai tracks", () => {
  const tracks = derivedTracksAt(53.7569, -1.4430, stations);
  assert.deepEqual(tracks.map((t) => t.ref), ["1", "2"]);
  assert.equal(tracks[0].on_track, true);
});

test("a point far from every derived station has none", () => {
  assert.equal(derivedTracksAt(53.9, -1.2, stations), null);
});

test("a station with no placed platforms has none", () => {
  assert.equal(derivedTracksAt(51.5, -0.1, stations), null);
});
