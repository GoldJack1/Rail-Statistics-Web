import { test } from "node:test";
import assert from "node:assert/strict";
import {
  corridorGeometryMids,
  metresToMiles,
  ormIntermediatePath,
  shortestOrmPath,
  stitchCallsWithOrmPath,
  triangleCorridorMids,
} from "./orm-path.js";
import { isNonPassengerLocation } from "./geometry-densify.js";

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
  const geoByTpl = new Map([
    ["WHRDJN", { tiploc: "WHRDJN", lat: 53.79193, lon: -1.55945 }],
    ["HOLBJCN", { tiploc: "HOLBJCN", lat: 53.79147, lon: -1.56836 }],
    ["COTNGLY", { tiploc: "COTNGLY", lat: 53.76782, lon: -1.58771 }],
  ]);
  const tipocMeta = new Map([["HOLBJCN", { crs: "", name: "Holbeck Junction" }]]);
  const hit = ormIntermediatePath(adj, "WHRDJN", "COTNGLY", { tipocMeta, geoByTpl });
  assert.ok(hit);
  assert.deepEqual(hit.mids, ["HOLBJCN"]);
  assert.ok(hit.metres > 2500 && hit.metres < 4000);
});

test("Mirfield station is not invented without an edge", () => {
  const adj = undirected([
    ["HDRSFLD", "DWBY", 10000],
  ]);
  const hit = ormIntermediatePath(adj, "HDRSFLD", "DWBY");
  assert.ok(hit);
  assert.deepEqual(hit.mids, []);
});

test("stitch attaches leg/cum metres for corridor CRS mid", () => {
  const adj = undirected([
    ["A", "COT", 1000],
    ["COT", "B", 1000],
    ["A", "B", 2200],
  ]);
  const geoByTpl = new Map([
    ["A", { tiploc: "A", lat: 53.792, lon: -1.56 }],
    ["COT", { tiploc: "COT", lat: 53.768, lon: -1.588 }],
    ["B", { tiploc: "B", lat: 53.75, lon: -1.591 }],
  ]);
  const tipocMeta = new Map([["COT", { crs: "COT", name: "Cottingley" }]]);
  const { calls, inserted } = stitchCallsWithOrmPath(
    [
      { tiploc: "A", wtp: "10:00", is_passing: 1 },
      { tiploc: "B", wtp: "10:10", is_passing: 1 },
    ],
    adj,
    { tipocMeta, geoByTpl },
  );
  assert.equal(inserted, 1);
  assert.equal(calls[1].tiploc, "COT");
  assert.ok(calls[1].leg_m > 0);
  assert.ok(calls[2].cum_m >= calls[1].cum_m);
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

test("triangle corridor skips short gaps and non-detours", () => {
  const adj = undirected([
    ["A", "M", 100],
    ["M", "B", 100],
    ["A", "B", 250],
  ]);
  const geoByTpl = new Map([
    ["A", { tiploc: "A", lat: 53.7, lon: -1.9 }],
    ["M", { tiploc: "M", lat: 53.701, lon: -1.899 }],
    ["B", { tiploc: "B", lat: 53.702, lon: -1.898 }],
  ]);
  assert.deepEqual(triangleCorridorMids(adj, "A", "B", { geoByTpl, tipocMeta: new Map() }), []);
});

test("corridor geometry inserts Holbeck and Cottingley between Whitehall and Morley", () => {
  const geoByTpl = new Map([
    ["WHRDJN", { tiploc: "WHRDJN", lat: 53.79193, lon: -1.55945 }],
    ["HOLBJCN", { tiploc: "HOLBJCN", lat: 53.79147, lon: -1.56836 }],
    ["COTNGLY", { tiploc: "COTNGLY", lat: 53.76782, lon: -1.58771 }],
    ["MRLY", { tiploc: "MRLY", lat: 53.74992, lon: -1.59098 }],
    ["EGLSMSL", { tiploc: "EGLSMSL", lat: 53.78, lon: -1.57 }],
  ]);
  const tipocMeta = new Map([
    ["HOLBJCN", { crs: "", name: "Holbeck Junction" }],
    ["COTNGLY", { crs: "COT", name: "Cottingley" }],
    ["EGLSMSL", { crs: "", name: "Eaglescliffe Marshalls Ews" }],
  ]);
  const mids = corridorGeometryMids("WHRDJN", "MRLY", { tipocMeta, geoByTpl });
  assert.ok(mids.includes("HOLBJCN"));
  assert.ok(mids.includes("COTNGLY"));
  assert.ok(!mids.includes("EGLSMSL"));
});

test("junk tipocs are non-passenger", () => {
  assert.equal(isNonPassengerLocation("MLNR8", { name: "MLNR8" }), true);
  assert.equal(isNonPassengerLocation("CSTL30", { name: "Castleton Signal Ce30" }), true);
  assert.equal(isNonPassengerLocation("YORKLIP", { name: "York Fuelling Point" }), true);
  assert.equal(isNonPassengerLocation("HOLBJCN", { name: "Holbeck Junction" }), false);
});
