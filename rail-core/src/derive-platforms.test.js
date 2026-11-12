import assert from "node:assert/strict";
import test from "node:test";
import { derivePlatforms } from "./derive-platforms.js";

const pin = { lat: 53.75679, lng: -1.44288 };
const kx = 111_320 * Math.cos((pin.lat * Math.PI) / 180);
/** A line running north through the station, `east` metres east of the pin. */
const northLine = (east, south = -300, north = 300) => {
  const out = [];
  for (let y = south; y <= north; y += 25) out.push([pin.lng + east / kx, pin.lat + y / 110_540]);
  return out;
};
const to = (y) => ({ lat: pin.lat + y / 110_540, lng: pin.lng });
const book = (ref, direction, times) =>
  Array.from({ length: times }, () => ({ ref, prev: to(direction === "north" ? -3000 : 3000), next: to(direction === "north" ? 3000 : -3000) }));

test("with a pair of tracks, northbound trains take the west one and southbound the east one", () => {
  const lines = [northLine(-2.5), northLine(2.5)];
  const { tracks } = derivePlatforms({ pin, lines, calls: [...book("1", "south", 9), ...book("2", "north", 9)] });
  const one = tracks.find((track) => track.ref === "1");
  const two = tracks.find((track) => track.ref === "2");
  assert.ok(one.lng > pin.lng, "platform 1, southbound, is on the east track");
  assert.ok(two.lng < pin.lng, "platform 2, northbound, is on the west track");
});

test("a station with one track puts every platform on it", () => {
  const { tracks } = derivePlatforms({ pin, lines: [northLine(0.5)], calls: [...book("1", "north", 6), ...book("1", "south", 6)] });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].ref, "1");
});

test("platforms that cannot be told apart are left out", () => {
  const lines = [northLine(-2.5), northLine(2.5)];
  const both = derivePlatforms({ pin, lines, calls: [...book("1", "north", 8), ...book("1", "south", 8)] });
  assert.equal(both.tracks.length, 0);
  assert.equal(both.skipped[0].reason, "trains both ways");
  const same = derivePlatforms({ pin, lines, calls: [...book("1", "north", 8), ...book("2", "north", 8)] });
  assert.equal(same.tracks.length, 0);
});

test("too few bookings place nothing", () => {
  const { tracks, skipped } = derivePlatforms({ pin, lines: [northLine(-2.5), northLine(2.5)], calls: book("1", "north", 2) });
  assert.equal(tracks.length, 0);
  assert.equal(skipped[0].reason, "too few bookings");
});

test("a siding beside a through pair is not a third platform road", () => {
  const lines = [northLine(-2.5), northLine(2.5), northLine(26)];
  const { tracks } = derivePlatforms({ pin, lines, calls: [...book("1", "south", 9), ...book("2", "north", 9)] });
  assert.equal(tracks.length, 2);
});
