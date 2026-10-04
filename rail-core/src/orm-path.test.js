import { test } from "node:test";
import assert from "node:assert/strict";
import {
  metresToMiles,
  ormIntermediatePath,
  shortestOrmPath,
  stitchCallsWithOrmPath,
  triangleCorridorMids,
} from "./orm-path.js";

function undirected(pairs) {
  const adj = new Map();
  const add = (a, b, metres) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, metres });
    adj.get(b).push({ to: a, metres });
  };
  for (const [a, b, m] of pairs) add(a, b, m);
  return adj;
}

test("shortest path inserts Holbeck between Whitehall and Cottingley", () => {
  const adj = undirected([
    ["WHRDJN", "HOLBJCN", 800],
    ["HOLBJCN", "COTNGLY", 2200],
    ["WHRDJN", "COTNGLY", 5000],
  ]);
  const hit = ormIntermediatePath(adj, "WHRDJN", "COTNGLY");
  assert.ok(hit);
  assert.deepEqual(hit.mids, ["HOLBJCN"]);
  assert.equal(hit.metres, 3000);
});

test("Mirfield station is not invented without an edge", () => {
  const adj = undirected([
    ["HDRSFLD", "DWBY", 10000],
  ]);
  const hit = ormIntermediatePath(adj, "HDRSFLD", "DWBY");
  assert.ok(hit);
  assert.deepEqual(hit.mids, []);
});

test("stitch attaches leg/cum metres and skips CRS mids", () => {
  const adj = undirected([
    ["A", "JN1", 1000],
    ["JN1", "B", 1000],
    ["A", "STN", 500],
    ["STN", "B", 500],
  ]);
  const tipocMeta = new Map([
    ["JN1", { crs: "", name: "Junction One" }],
    ["STN", { crs: "STN", name: "Station" }],
  ]);
  const { calls, inserted } = stitchCallsWithOrmPath(
    [
      { tiploc: "A", wtp: "10:00", is_passing: 1 },
      { tiploc: "B", wtp: "10:10", is_passing: 1 },
    ],
    adj,
    { tipocMeta },
  );
  assert.equal(inserted, 1);
  assert.equal(calls[1].tiploc, "JN1");
  assert.ok(calls[1].leg_m > 0);
  assert.ok(calls[2].cum_m >= calls[1].cum_m);
  assert.ok(!calls.some((c) => c.tiploc === "STN"));
});

test("metresToMiles", () => {
  assert.equal(metresToMiles(1609.344), 1);
  assert.equal(metresToMiles(null), null);
});

test("unreachable returns null", () => {
  const adj = undirected([["A", "B", 1]]);
  assert.equal(shortestOrmPath(adj, "A", "Z"), null);
});

test("triangle corridor inserts Holbeck when direct chord is shorter", () => {
  const adj = undirected([
    ["WHRDJN", "HOLBJCN", 587],
    ["HOLBJCN", "COTNGLY", 2922],
    ["WHRDJN", "COTNGLY", 3261],
  ]);
  const geoByTpl = new Map([
    ["WHRDJN", { tiploc: "WHRDJN", lat: 53.79193, lon: -1.55945 }],
    ["HOLBJCN", { tiploc: "HOLBJCN", lat: 53.79147, lon: -1.56836 }],
    ["COTNGLY", { tiploc: "COTNGLY", lat: 53.76782, lon: -1.58771 }],
  ]);
  const tipocMeta = new Map([["HOLBJCN", { crs: "", name: "Holbeck Junction" }]]);
  assert.deepEqual(triangleCorridorMids(adj, "WHRDJN", "COTNGLY", { tipocMeta, geoByTpl }), [
    "HOLBJCN",
  ]);
  const hit = ormIntermediatePath(adj, "WHRDJN", "COTNGLY", { tipocMeta, geoByTpl });
  assert.deepEqual(hit.mids, ["HOLBJCN"]);
});
