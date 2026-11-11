import assert from "node:assert/strict";
import test from "node:test";
import { applyPlatformRules, platformRailRoute, readStops, serviceRoute, unbookedCallBearings } from "./service-route.js";

const stop = (index, lat, lng, more = {}) => ({
  index, lat, lng, tpl: `T${index}`, crs: null, calling: true, kind: "stop", cancelled: false, platform: null, path: null, line: null, ...more,
});
const stand = (lat, lng) => ({ lat, lng, ends: [[lat, lng], [lat, lng]], stand: [lat, lng] });
const P1 = stand(54.332818, -1.441544);
const P2 = stand(54.333232, -1.441844);

/** Thirsk, Northallerton, Darlington: a northbound call with no platform booked. */
const northbound = () => [
  stop(0, 54.2282, -1.3726, { platform: "1" }),
  stop(1, 54.3330789, -1.441275691, { crs: "NTR", tpl: "NLRTN" }),
  stop(2, 54.5204, -1.5473, { platform: "4" }),
];

/** A straight line through the points, about every 100 m. */
function straight(points) {
  const path = [];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const steps = Math.max(2, Math.round(Math.hypot((b[0] - a[0]) * 111_320, (b[1] - a[1]) * 65_000) / 100));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) path.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }
  return path;
}

test("a request needs placed stops with whole indexes", () => {
  assert.equal(readStops({ stops: [stop(0, 54, -1)] }), null);
  assert.equal(readStops({ stops: [stop(0, 54, -1), stop(0, 55, -1)] }), null);
  assert.equal(readStops({ stops: [stop(0, 0, 0), stop(1, 55, -1)] }), null);
  assert.equal(readStops({ stops: [stop(1, 55, -1), stop(0, 54, -1)] })[0].index, 0);
});

test("a rule books its platform only where the service matches", () => {
  const rules = [{ id: "morley-west", at: ["MLY"], direction: "west", platform: "2", replace: ["", "1"] }];
  const west = [stop(0, 53.79, -1.55), stop(1, 53.75, -1.59, { crs: "MLY" }), stop(2, 53.65, -1.78)];
  assert.equal(applyPlatformRules(west, "TP", rules)[1].platform, "2");
  const east = [stop(0, 53.65, -1.78), stop(1, 53.75, -1.59, { crs: "MLY" }), stop(2, 53.79, -1.55)];
  assert.equal(applyPlatformRules(east, "TP", rules)[1].platform, null);
  const other = [stop(0, 53.79, -1.55), stop(1, 53.75, -1.59, { crs: "MLY", platform: "3" }), stop(2, 53.65, -1.78)];
  assert.equal(applyPlatformRules(other, "TP", rules)[1].platform, "3");
});

test("only a call on the way with no platform gets a bearing", () => {
  const bearings = unbookedCallBearings(northbound());
  assert.deepEqual(Object.keys(bearings), ["1"]);
  assert.ok(bearings["1"] >= 330 && bearings["1"] <= 345);
});

test("a northbound call at Northallerton is routed through platform 2 and marked there", async () => {
  const asked = [];
  const routed = [];
  const drawn = await serviceRoute({ toc: "TP", stops: northbound() }, {
    rules: [],
    platforms: async (requests) => {
      asked.push(...requests);
      const left = requests.find((request) => request.platform.startsWith("left@"));
      return left ? { [left.id]: { ...P2, guess: true } } : {};
    },
    route: async (points) => {
      routed.push(points);
      return straight(points);
    },
  });
  assert.match(asked.find((request) => request.id === "1").platform, /^left@3[34]\d$/);
  assert.deepEqual(routed[0][1], [P2.lat, P2.lng]);
  assert.equal(drawn.complete, true);
  assert.deepEqual(drawn.marks["1"], [P2.lat, P2.lng]);
  assert.deepEqual(drawn.markers["1"], [P2.lat, P2.lng]);
  assert.equal(drawn.platforms["1"].guess, true);
  assert.ok(drawn.path.length > 10);
});

test("a rule's platform is reported and looked up", async () => {
  const asked = [];
  const drawn = await serviceRoute({ toc: "TP", stops: northbound() }, {
    rules: [{ id: "ntr", at: ["NTR"], platform: "2", replace: [""] }],
    platforms: async (requests) => {
      asked.push(...requests);
      return { 1: P2 };
    },
    route: async (points) => straight(points),
  });
  assert.equal(asked.find((request) => request.id === "1").platform, "2");
  assert.deepEqual(drawn.booked, { 1: "2" });
});

test("a platform far from its station is not used", async () => {
  const drawn = await serviceRoute({ stops: northbound() }, {
    rules: [],
    platforms: async () => ({ 1: stand(54.40, -1.44) }),
    route: async (points) => straight(points),
  });
  assert.deepEqual(drawn.platforms, {});
  assert.equal(drawn.marks["1"], undefined);
});

/** The route shunts back at a guessed call until that call is left out. */
const shuntingRoute = (calls) => async (points) => {
  calls.push(points);
  if (points.length === 3) {
    const [from, mid, to] = points;
    const beyond = [mid[0] + 0.004, mid[1] - 0.003];
    return [...straight([from, beyond]), ...straight([beyond, mid]).slice(1), ...straight([mid, to]).slice(1)];
  }
  return straight([points[0], [54.3331, -1.4413], points[1]]);
};
const guessedVias = () => [
  { lat: 54.2282, lng: -1.3726, loose: { lat: 54.2282, lng: -1.3726 }, call: true },
  { lat: P1.lat, lng: P1.lng, loose: { lat: 54.3330789, lng: -1.441275691 }, call: true, guess: true },
  { lat: 54.5204, lng: -1.5473, loose: { lat: 54.5204, lng: -1.5473 }, call: true },
];

test("a guessed call that makes the route shunt back is left out", async () => {
  const calls = [];
  const drawn = await platformRailRoute(guessedVias(), shuntingRoute(calls));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].length, 2);
  assert.equal(drawn.complete, true);
});

test("a draft is the first answer", async () => {
  const calls = [];
  const drawn = await platformRailRoute(guessedVias(), shuntingRoute(calls), true);
  assert.equal(calls.length, 1);
  assert.equal(drawn.complete, false);
});

test("a booked call keeps its platform when the route reverses there", async () => {
  const calls = [];
  const vias = guessedVias();
  delete vias[1].guess;
  await platformRailRoute(vias, shuntingRoute(calls));
  assert.equal(calls.length, 1);
});
