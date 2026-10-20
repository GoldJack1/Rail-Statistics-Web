import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorIsolatedPlaces, orderByTrack, orderClosePlaces } from "./gtcl-path.js";

function line(points) {
  const edges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    edges.push({ ax, ay, bx, by, len: Math.hypot(bx - ax, by - ay) });
  }
  const adj = new Map();
  for (const edge of edges) {
    for (const key of [`${edge.ax},${edge.ay}`, `${edge.bx},${edge.by}`]) {
      const list = adj.get(key) || [];
      list.push(edge);
      adj.set(key, list);
    }
  }
  return { edges, adj };
}

function order(calls, graph, locs) {
  return orderByTrack(calls, graph, locs).map((row) => row.tiploc);
}

test("a southbound report sits where the track passes it, not where the clock put it", () => {
  const graph = line([
    [0, 1000],
    [0, 700],
    [0, 400],
    [0, 0],
  ]);
  const locs = [
    { tiploc: "NCL", e: 0, n: 1000 },
    { tiploc: "KEBN", e: 0, n: 700 },
    { tiploc: "KEBS", e: 0, n: 400 },
    { tiploc: "LOWFELL", e: 0, n: 0 },
  ];
  const calls = [
    { tiploc: "NCL", wtd: "19:02" },
    { tiploc: "KEBS", atp: "19:03" },
    { tiploc: "KEBN", atp: "19:03" },
    { tiploc: "LOWFELL", wtp: "19:05" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["NCL", "KEBN", "KEBS", "LOWFELL"]);
});

test("going west, the junction is ordered by chainage even when its name says east", () => {
  const graph = line([
    [1000, 0],
    [600, 0],
    [400, 0],
    [0, 0],
  ]);
  const locs = [
    { tiploc: "DWBY", e: 1000, n: 0 },
    { tiploc: "MIRFEJN", e: 600, n: 0 },
    { tiploc: "MIRFILD", e: 400, n: 0 },
    { tiploc: "HDRSFLD", e: 0, n: 0 },
  ];
  const calls = [
    { tiploc: "DWBY", wtp: "20:39" },
    { tiploc: "MIRFILD", atp: "20:42" },
    { tiploc: "MIRFEJN", atp: "20:42" },
    { tiploc: "HDRSFLD", wta: "20:46" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["DWBY", "MIRFEJN", "MIRFILD", "HDRSFLD"]);
});

test("going east, the same track puts the station before the junction", () => {
  const graph = line([
    [0, 0],
    [400, 0],
    [600, 0],
    [1000, 0],
  ]);
  const locs = [
    { tiploc: "HDRSFLD", e: 0, n: 0 },
    { tiploc: "MIRFILD", e: 400, n: 0 },
    { tiploc: "MIRFEJN", e: 600, n: 0 },
    { tiploc: "DWBY", e: 1000, n: 0 },
  ];
  const calls = [
    { tiploc: "HDRSFLD", wtd: "20:49" },
    { tiploc: "MIRFEJN", atp: "21:05" },
    { tiploc: "MIRFILD", atp: "21:05" },
    { tiploc: "DWBY", wta: "21:10" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["HDRSFLD", "MIRFILD", "MIRFEJN", "DWBY"]);
});

test("a report in the wrong gap moves back to the stretch of track it lies on", () => {
  const graph = line([
    [0, 0],
    [0, 500],
    [0, 1000],
    [0, 1500],
    [0, 2000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "F", e: 0, n: 200 },
    { tiploc: "B", e: 0, n: 1000 },
    { tiploc: "C", e: 0, n: 2000 },
  ];
  const calls = [
    { tiploc: "A", wtd: "10:00" },
    { tiploc: "B", wtp: "10:10" },
    { tiploc: "F", atp: "10:12" },
    { tiploc: "C", wta: "10:20" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "F", "B", "C"]);
});

test("an inferred junction does not stay in front of the report it was inserted before", () => {
  const graph = line([
    [0, 0],
    [400, 0],
    [800, 0],
    [1200, 0],
  ]);
  const locs = [
    { tiploc: "MIRFEJN", e: 0, n: 0 },
    { tiploc: "MIRFILD", e: 400, n: 0 },
    { tiploc: "HETNLEJ", e: 800, n: 0 },
    { tiploc: "HETNLJN", e: 1200, n: 0 },
  ];
  const calls = [
    { tiploc: "MIRFEJN", wtp: "12:59" },
    { tiploc: "HETNLEJ", wtp: "13:00", actual_source: "inferred" },
    { tiploc: "MIRFILD", atp: "13:02" },
    { tiploc: "HETNLJN", wtp: "13:01" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["MIRFEJN", "MIRFILD", "HETNLEJ", "HETNLJN"]);
});

test("booked passes between advertised calls follow the track", () => {
  const graph = line([
    [0, 0],
    [0, 500],
    [0, 1000],
    [0, 2000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "B", e: 0, n: 500 },
    { tiploc: "C", e: 0, n: 1000 },
    { tiploc: "D", e: 0, n: 2000 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "C", wtp: "10:10" },
    { tiploc: "B", wtp: "10:05" },
    { tiploc: "D", sta: "10:20", wta: "10:20" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "B", "C", "D"]);
});

test("a pass just beyond the next station is not clamped in front of it", () => {
  const graph = line([
    [0, 0],
    [0, 1000],
    [0, 2000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "B", e: 0, n: 1000 },
    { tiploc: "J", e: 0, n: 1040 },
    { tiploc: "C", e: 0, n: 2000 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "J", wtp: "10:09", actual_source: "inferred" },
    { tiploc: "B", std: "10:10", wtd: "10:10" },
    { tiploc: "C", sta: "10:20", wta: "10:20" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "B", "J", "C"]);
});

test("an edge stored against the direction of travel keeps pass order", () => {
  const graph = line([
    [0, 0],
    [0, 2000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 2000 },
    { tiploc: "B", e: 0, n: 1500 },
    { tiploc: "C", e: 0, n: 500 },
    { tiploc: "D", e: 0, n: 0 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "C", wtp: "10:12" },
    { tiploc: "B", wtp: "10:08" },
    { tiploc: "D", sta: "10:20", wta: "10:20" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "B", "C", "D"]);
});

test("a reversal keeps the outward pass and the return pass on their own legs", () => {
  const graph = line([
    [0, 0],
    [0, 500],
    [0, 1000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "J", e: 0, n: 500 },
    { tiploc: "B", e: 0, n: 1000 },
    { tiploc: "C", e: 0, n: 0 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "J", wtp: "10:15" },
    { tiploc: "B", std: "10:10", wtd: "10:10" },
    { tiploc: "J", wtp: "10:05" },
    { tiploc: "C", sta: "10:20", wta: "10:20" },
  ];
  assert.deepEqual(
    orderByTrack(calls, graph, locs).map((row) => row.wtp || row.std || row.sta),
    ["10:00", "10:05", "10:10", "10:15", "10:20"],
  );
});

test("a junction just off a corner is kept on that leg", () => {
  const graph = line([
    [0, 0],
    [0, 1000],
    [1000, 1000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "J", e: -30, n: 1030 },
    { tiploc: "C", e: 1000, n: 1000 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "C", sta: "10:20", wta: "10:20" },
    { tiploc: "J", wtp: "10:18", actual_source: "inferred" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "J", "C"]);
});

test("booked calls stay in timetable order", () => {
  const graph = line([
    [0, 1000],
    [0, 0],
  ]);
  const locs = [
    { tiploc: "NORTH", e: 0, n: 800 },
    { tiploc: "SOUTH", e: 0, n: 200 },
  ];
  const calls = [
    { tiploc: "SOUTH", wtp: "12:01" },
    { tiploc: "NORTH", wtp: "12:02" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["SOUTH", "NORTH"]);
});

test("a junction 20 m the wrong side of its station still follows the direction of travel", () => {
  const locs = [
    { tiploc: "DWBY", name: "Dewsbury", e: 1000, n: 0 },
    { tiploc: "MIRFILD", name: "Mirfield", e: 610, n: 0 },
    { tiploc: "MIRFEJN", name: "Mirfield East Junction", e: 600, n: 0 },
    { tiploc: "HDRSFLD", name: "Huddersfield", e: 0, n: 0 },
  ];
  const west = orderClosePlaces(
    [
      { tiploc: "DWBY" },
      { tiploc: "MIRFILD" },
      { tiploc: "MIRFEJN" },
      { tiploc: "HDRSFLD" },
    ],
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(west, ["DWBY", "MIRFEJN", "MIRFILD", "HDRSFLD"]);
  const east = orderClosePlaces(
    [
      { tiploc: "HDRSFLD" },
      { tiploc: "MIRFEJN" },
      { tiploc: "MIRFILD" },
      { tiploc: "DWBY" },
    ],
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(east, ["HDRSFLD", "MIRFILD", "MIRFEJN", "DWBY"]);
});

test("places more than 120 m apart are not reordered by name", () => {
  const locs = [
    { tiploc: "A", name: "Dewsbury", e: 4000, n: 0 },
    { tiploc: "B", name: "Mirfield", e: 2500, n: 0 },
    { tiploc: "C", name: "Mirfield East Junction", e: 1000, n: 0 },
    { tiploc: "D", name: "Huddersfield", e: 0, n: 0 },
  ];
  const out = orderClosePlaces(
    ["A", "B", "C", "D"].map((tiploc) => ({ tiploc })),
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(out, ["A", "B", "C", "D"]);
});

test("an east junction plotted west of the same place is put back when travelling west", () => {
  const locs = [
    { tiploc: "MOORS", name: "Margam Moors Junction", e: 3000, n: 0 },
    { tiploc: "MID", name: "Margam Middle Junction", e: 1800, n: 0 },
    { tiploc: "EAST", name: "Margam East Junction", e: 824, n: 0 },
    { tiploc: "PORT", name: "Port Talbot Parkway", e: 0, n: 0 },
  ];
  const out = orderClosePlaces(
    ["MOORS", "MID", "EAST", "PORT"].map((tiploc) => ({ tiploc })),
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(out, ["MOORS", "EAST", "MID", "PORT"]);
});

test("drayton road stays before a south junction that sits between it and the station", () => {
  const locs = [
    { tiploc: "LEI", name: "Leighton Buzzard", e: 0, n: 0 },
    { tiploc: "DRAY", name: "Bletchley Drayton Road Junction", e: 0, n: 1200 },
    { tiploc: "SOUTH", name: "Bletchley South Junction", e: 0, n: 1600 },
    { tiploc: "STN", name: "Bletchley", e: 0, n: 1800 },
    { tiploc: "MK", name: "Milton Keynes Central", e: 0, n: 4000 },
  ];
  const out = orderClosePlaces(
    ["LEI", "DRAY", "SOUTH", "STN", "MK"].map((tiploc) => ({ tiploc })),
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(out, ["LEI", "DRAY", "SOUTH", "STN", "MK"]);
});

test("a correctly plotted east junction a kilometre away stays where the track put it", () => {
  const locs = [
    { tiploc: "WEST", name: "Leeds", e: 0, n: 0 },
    { tiploc: "STN", name: "Garforth", e: 2000, n: 0 },
    { tiploc: "EAST", name: "East Garforth", e: 2929, n: 0 },
    { tiploc: "NEXT", name: "Micklefield", e: 5000, n: 0 },
  ];
  const out = orderClosePlaces(
    ["WEST", "STN", "EAST", "NEXT"].map((tiploc) => ({ tiploc })),
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(out, ["WEST", "STN", "EAST", "NEXT"]);
});

test("a junction plotted a kilometre from all of its neighbours uses those neighbours", () => {
  const locs = [
    { tiploc: "SOUTH", name: "Bletchley South Junction", e: 0, n: 0 },
    { tiploc: "DRAYTON", name: "Bletchley Drayton Road Junction", e: 0, n: 1200 },
    { tiploc: "STN", name: "Bletchley", crs: "BLY", e: 0, n: 1800 },
    { tiploc: "SIDING", name: "Bletchley Field Sidings", e: 40, n: 1850 },
  ];
  anchorIsolatedPlaces(locs, [
    ["SOUTH", "STN"],
    ["SOUTH", "SIDING"],
    ["SOUTH", "DRAYTON"],
  ]);
  const south = locs.find((loc) => loc.tiploc === "SOUTH");
  assert.ok(south.n > 1500 && south.n < 1750);
});

test("a place plotted off the railway still sits beside the station it belongs to", () => {
  const graph = line([
    [0, 0],
    [0, 3000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "B", e: 0, n: 1000 },
    { tiploc: "C", e: 1200, n: 1000 },
    { tiploc: "D", e: 0, n: 3000 },
  ];
  const calls = [
    { tiploc: "A", std: "10:00", wtd: "10:00" },
    { tiploc: "C", wtp: "10:19" },
    { tiploc: "B", wtp: "10:05" },
    { tiploc: "D", sta: "10:20", wta: "10:20" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "C", "B", "D"]);
});

test("a coal yard north of the north junction stays north of it", () => {
  const locs = [
    { tiploc: "WNSFD", name: "Winsford", e: 0, n: 3000 },
    { tiploc: "YARD", name: "Crewe Coal Yard", e: 0, n: 1900 },
    { tiploc: "NORTH", name: "Crewe North Junction", e: 0, n: 1000 },
    { tiploc: "CREWE", name: "Crewe", e: 0, n: 0 },
  ];
  const out = orderClosePlaces(
    ["WNSFD", "YARD", "NORTH", "CREWE"].map((tiploc) => ({ tiploc })),
    locs,
  ).map((row) => row.tiploc);
  assert.deepEqual(out, ["WNSFD", "YARD", "NORTH", "CREWE"]);
});

test("a point off the route is left where it was", () => {
  const graph = line([
    [0, 0],
    [0, 1000],
  ]);
  const locs = [
    { tiploc: "A", e: 0, n: 0 },
    { tiploc: "B", e: 0, n: 1000 },
    { tiploc: "OFF", e: 500, n: 500 },
  ];
  const calls = [
    { tiploc: "A", wtd: "09:00" },
    { tiploc: "OFF", atp: "09:05" },
    { tiploc: "B", wta: "09:10" },
  ];
  assert.deepEqual(order(calls, graph, locs), ["A", "OFF", "B"]);
});
