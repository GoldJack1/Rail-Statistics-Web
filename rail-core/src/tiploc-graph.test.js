import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addPathEdges,
  bestIntermediatePath,
  fillCallsWithGraph,
  interpolateHm,
} from "./tiploc-graph.js";
import { jsonScheduleRunsOn } from "./cif-overlay.js";
import { cifUpdateDayName } from "./fetch-schedule.js";

test("best path inserts Cottingley between Whitehall and Morley", () => {
  const edges = new Map();
  addPathEdges(edges, ["WHRDJN", "COTNGLY", "MRLY"]);
  addPathEdges(edges, ["WHRDJN", "COTNGLY", "MRLY"]);
  // bump weights
  for (let i = 0; i < 50; i++) addPathEdges(edges, ["WHRDJN", "COTNGLY", "MRLY"]);
  const adj = new Map();
  for (const [key, weight] of edges) {
    const [from, to] = key.split("\t");
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push({ to, weight });
  }
  assert.deepEqual(bestIntermediatePath(adj, "WHRDJN", "MRLY"), ["COTNGLY"]);
});

test("best path prefers a direct edge over a heavier junction detour", () => {
  const adj = new Map([
    // Milner Royd → Greetland direct, vs Dryclough detour (higher total weight).
    ["MLNRYDJ", [{ to: "DYCLJN", weight: 959 }, { to: "GRTLNDJ", weight: 1475 }]],
    ["DYCLJN", [{ to: "GRTLNDJ", weight: 503 }, { to: "HLFX", weight: 1473 }]],
    ["GRTLNDJ", [{ to: "BRHOUSE", weight: 1533 }, { to: "BRLYWJN", weight: 443 }]],
    ["BRLYWJN", [{ to: "BRLYJN", weight: 89 }, { to: "BRHOUSE", weight: 1479 }]],
    ["BRLYJN", [{ to: "HDRSFLD", weight: 1415 }]],
    ["HDRSFLD", [{ to: "BRHOUSE", weight: 499 }]],
  ]);
  const stations = new Set(["BRHOUSE", "HDRSFLD", "HLFX"]);
  assert.equal(bestIntermediatePath(adj, "MLNRYDJ", "GRTLNDJ", { stationMids: stations }), null);
  assert.deepEqual(bestIntermediatePath(adj, "MLNRYDJ", "BRHOUSE", { stationMids: stations }), ["GRTLNDJ"]);
  assert.equal(bestIntermediatePath(adj, "GRTLNDJ", "BRHOUSE", { stationMids: stations }), null);
});

test("station mid densifies even when a direct edge exists (Cottingley/Batley)", () => {
  const adj = new Map([
    ["MRLY", [{ to: "WHRDJN", weight: 2330 }, { to: "COTNGLY", weight: 317 }]],
    ["COTNGLY", [{ to: "WHRDJN", weight: 309 }]],
    ["DWBY", [{ to: "MRLY", weight: 2079 }, { to: "BATLEY", weight: 568 }]],
    ["BATLEY", [{ to: "MRLY", weight: 568 }]],
  ]);
  const stations = new Set(["COTNGLY", "BATLEY", "MRLY", "DWBY"]);
  assert.deepEqual(bestIntermediatePath(adj, "MRLY", "WHRDJN", { stationMids: stations }), ["COTNGLY"]);
  assert.deepEqual(bestIntermediatePath(adj, "DWBY", "MRLY", { stationMids: stations }), ["BATLEY"]);
  // Junction-only mid must not densify across a direct edge.
  assert.equal(
    bestIntermediatePath(
      new Map([
        ["MLNRYDJ", [{ to: "GRTLNDJ", weight: 1475 }, { to: "DYCLJN", weight: 959 }]],
        ["DYCLJN", [{ to: "GRTLNDJ", weight: 503 }]],
      ]),
      "MLNRYDJ",
      "GRTLNDJ",
      { stationMids: stations },
    ),
    null,
  );
});

test("best path still fills a single mid when no direct edge exists", () => {
  const adj = new Map([
    ["A", [{ to: "X", weight: 10 }, { to: "B", weight: 200 }]],
    ["X", [{ to: "B", weight: 10 }]],
    ["B", [{ to: "C", weight: 200 }]],
  ]);
  assert.equal(bestIntermediatePath(adj, "A", "B"), null); // direct wins
  assert.deepEqual(bestIntermediatePath(adj, "A", "C"), ["B"]);
});

test("interpolateHm splits the gap", () => {
  assert.equal(interpolateHm("10:00", "10:06", 0, 2), "10:02");
  assert.equal(interpolateHm("10:00", "10:06", 1, 2), "10:04");
});

test("interpolateHm does not overnight-wrap small inverted spine clocks", () => {
  assert.equal(interpolateHm("17:27", "17:25", 0, 1), "17:27");
  assert.equal(interpolateHm("23:50", "00:10", 0, 1), "00:00");
});

test("fillCallsWithGraph inserts Batley between Morley and Dewsbury", () => {
  const adj = new Map([
    ["MRLY", [{ to: "BATLEY", weight: 100 }]],
    ["BATLEY", [{ to: "DWBY", weight: 100 }]],
  ]);
  const { calls, inserted } = fillCallsWithGraph(
    [
      { tiploc: "MRLY", wtp: "15:50", is_passing: 1, seq: 0 },
      { tiploc: "DWBY", sta: "15:55", std: "15:57", is_passing: 0, seq: 1 },
    ],
    adj,
  );
  assert.equal(inserted, 1);
  assert.equal(calls[1].tiploc, "BATLEY");
  assert.equal(calls[1].is_passing, 1);
  assert.equal(calls[1].wtp, interpolateHm("15:50", "15:55", 0, 1));
});

test("jsonScheduleRunsOn respects days and dates", () => {
  const sched = {
    schedule_start_date: "2026-10-04",
    schedule_end_date: "2026-10-04",
    schedule_days_runs: "0000001",
    CIF_stp_indicator: "O",
  };
  assert.equal(jsonScheduleRunsOn(sched, "2026-10-04"), true);
  assert.equal(jsonScheduleRunsOn(sched, "2026-10-05"), false);
  assert.equal(jsonScheduleRunsOn({ ...sched, CIF_stp_indicator: "C" }, "2026-10-04"), false);
});

test("cifUpdateDayName is a weekday code", () => {
  assert.match(cifUpdateDayName(new Date("2026-10-04T12:00:00Z")), /^(sun|mon|tue|wed|thu|fri|sat)$/);
});
