import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { dedupeNwkEdges, importBplanNwkEdges, parseNwkLine } from "./import-nwk-edges.js";
import { openCatalog } from "./db.js";
import { rebuildOrmGraphFromCatalog } from "./orm-path.js";
import { stitchCallsWithOrmPath } from "./orm-path.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../tt/ref/fixtures/holbeck-nwk.pif");

test("parseNwkLine extracts tiplocs and metres", () => {
  const edge = parseNwkLine("NWK\tA\tWHRDJN \tHOLBJCN\tFL1\t\t\t\tU\t\t587");
  assert.ok(edge);
  assert.equal(edge.from, "WHRDJN");
  assert.equal(edge.to, "HOLBJCN");
  assert.equal(edge.metres, 587);
});

test("parseNwkLine skips delete and missing distance", () => {
  assert.equal(parseNwkLine("NWK\tD\tWHRDJN \tHOLBJCN\tFL1\t\t\t\tU\t\t587"), null);
  assert.equal(parseNwkLine("NWK\tA\tWHRDJN \tHOLBJCN\tFL1"), null);
  assert.equal(parseNwkLine("LOC\tA\tWHRDJN"), null);
});

test("dedupeNwkEdges keeps shortest parallel line", () => {
  const edges = dedupeNwkEdges([
    { from: "A", to: "B", metres: 500, runningLine: "FL1" },
    { from: "A", to: "B", metres: 400, runningLine: "SL1" },
    { from: "B", to: "A", metres: 450, runningLine: "FL2" },
  ]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].metres, 400);
});

test("importBplanNwkEdges loads fixture into catalog", async () => {
  const tmp = mkdtempSync(join("/tmp", "nwk-import-"));
  try {
    const n = await importBplanNwkEdges(FIXTURE, tmp);
    assert.ok(n >= 5);
    const cat = openCatalog(tmp);
    const row = cat
      .prepare(`SELECT metres FROM nwk_edges WHERE from_tpl = 'WHRDJN' AND to_tpl = 'HOLBJCN'`)
      .get();
    cat.close();
    assert.equal(row.metres, 587);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("rebuildOrmGraphFromCatalog prefers NWK metres over haversine", async () => {
  const tmp = mkdtempSync(join("/tmp", "nwk-orm-"));
  try {
    const cat = openCatalog(tmp);
    cat.exec(`
      INSERT INTO tiploc_geo (tiploc, lat, lon) VALUES
        ('WHRDJN', 53.79193, -1.55945),
        ('HOLBJCN', 53.79147, -1.56836),
        ('COTNGLY', 53.76782, -1.58771);
    `);
    cat.close();
    await importBplanNwkEdges(FIXTURE, tmp);
    rebuildOrmGraphFromCatalog(tmp, { knn: 0 });
    const cat2 = openCatalog(tmp);
    const edge = cat2
      .prepare(
        `SELECT metres, source FROM orm_edges WHERE from_tpl = 'WHRDJN' AND to_tpl = 'HOLBJCN'`,
      )
      .get();
    cat2.close();
    assert.ok(edge);
    assert.equal(edge.metres, 587);
    assert.equal(edge.source, "nwk");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("NWK graph alone does not invent call rows for off-spine tipocs", () => {
  const adj = new Map();
  const add = (a, b, m) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, metres: m });
    adj.get(b).push({ to: a, metres: m });
  };
  // Spine A→B only; unrelated NWK pair is disconnected from the service spine.
  add("A", "B", 3000);
  add("JUNKONLY", "OTHERJX", 400);

  const geoByTpl = new Map([
    ["A", { tiploc: "A", lat: 53.79, lon: -1.56 }],
    ["B", { tiploc: "B", lat: 53.75, lon: -1.59 }],
    // Far from A–B chord — would never corridor-fill onto this RID.
    ["JUNKONLY", { tiploc: "JUNKONLY", lat: 54.5, lon: -2.1 }],
    ["OTHERJX", { tiploc: "OTHERJX", lat: 54.6, lon: -2.2 }],
  ]);
  const tipocMeta = new Map([
    ["JUNKONLY", { crs: "", name: "Junk Junction" }],
    ["OTHERJX", { crs: "", name: "Other Junction" }],
  ]);

  const { calls, inserted } = stitchCallsWithOrmPath(
    [
      { tiploc: "A", wtp: "10:00", is_passing: 1 },
      { tiploc: "B", wtp: "10:10", is_passing: 1 },
    ],
    adj,
    { tipocMeta, geoByTpl },
  );
  assert.equal(inserted, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.tiploc),
    ["A", "B"],
  );
});

test("NWK edge metres fill leg_m on stitched corridor", () => {
  const adj = new Map();
  const add = (a, b, m) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, metres: m });
    adj.get(b).push({ to: a, metres: m });
  };
  add("WHRDJN", "HOLBJCN", 587);
  add("HOLBJCN", "COTNGLY", 2922);
  add("WHRDJN", "COTNGLY", 3261);

  const geoByTpl = new Map([
    ["WHRDJN", { tiploc: "WHRDJN", lat: 53.79193, lon: -1.55945 }],
    ["HOLBJCN", { tiploc: "HOLBJCN", lat: 53.79147, lon: -1.56836 }],
    ["COTNGLY", { tiploc: "COTNGLY", lat: 53.76782, lon: -1.58771 }],
  ]);
  const tipocMeta = new Map([["HOLBJCN", { crs: "", name: "Holbeck Junction" }]]);

  const { calls, inserted } = stitchCallsWithOrmPath(
    [
      { tiploc: "WHRDJN", wtp: "10:00", is_passing: 1 },
      { tiploc: "COTNGLY", wtp: "10:10", is_passing: 1 },
    ],
    adj,
    { tipocMeta, geoByTpl },
  );
  assert.equal(inserted, 1);
  assert.equal(calls[1].tiploc, "HOLBJCN");
  assert.ok(calls[1].leg_m > 0);
  assert.ok(calls[2].leg_m > 0);
  assert.ok(calls[2].cum_m > calls[1].cum_m);
});
