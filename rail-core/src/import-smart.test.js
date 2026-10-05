import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ensureSmartTables,
  importSmartPayload,
  normalizeBerth,
  normalizeSmartRow,
  parseSmartPayload,
  resolveSmartTiploc,
} from "./import-smart.js";

const FIXTURE = JSON.stringify({
  SMART: [
    {
      TD: "Y2",
      FROMBERTH: "0001",
      TOBERTH: "HOLB",
      STANOX: "16421",
      EVENT: "C",
      PLATFORM: "",
    },
    {
      TD: "Y2",
      FROMBERTH: "HOLB",
      TOBERTH: "WHAL",
      STANOX: "16415",
      EVENT: "C",
    },
    {
      TD: "Y2",
      FROMBERTH: "X",
      TOBERTH: "Y",
      STANOX: "",
      EVENT: "A",
    },
  ],
});

test("parseSmartPayload reads SMART array", () => {
  const rows = parseSmartPayload(FIXTURE);
  assert.equal(rows.length, 3);
  const n = normalizeSmartRow(rows[0]);
  assert.equal(n.td_area, "Y2");
  assert.equal(n.to_berth, "HOLB");
  assert.equal(n.stanox, "16421");
  assert.equal(n.event_type, "C");
});

test("import + resolveSmartTiploc via CORPUS stanox", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE corpus (
      tiploc TEXT PRIMARY KEY,
      stanox TEXT,
      crs TEXT,
      name TEXT
    );
  `);
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("HOLBJCN", "16421", null, "Holbeck Junction");
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("WHRDJN", "16415", null, "Whitehall Junction");
  ensureSmartTables(db);
  const n = importSmartPayload(db, parseSmartPayload(FIXTURE));
  assert.ok(n >= 2);
  const hit = resolveSmartTiploc(db, "Y2", "HOLB");
  assert.equal(hit.tiploc, "HOLBJCN");
  assert.equal(hit.stanox, "16421");
  const miss = resolveSmartTiploc(db, "Y2", "NOPE");
  assert.equal(miss, null);
  db.close();
});

test("normalizeBerth pads numeric berths to four digits", () => {
  assert.equal(normalizeBerth("401"), "0401");
  assert.equal(normalizeBerth("0401"), "0401");
  assert.equal(normalizeBerth("HOLB"), "HOLB");
});

test("resolveSmartTiploc prefers from→to pair over to alone", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE corpus (
      tiploc TEXT PRIMARY KEY,
      stanox TEXT,
      crs TEXT,
      name TEXT
    );
  `);
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("ALPHA", "10001", null, "Alpha");
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("BETA", "10002", null, "Beta");
  ensureSmartTables(db);
  importSmartPayload(
    db,
    parseSmartPayload(
      JSON.stringify({
        SMART: [
          { TD: "T2", TOBERTH: "500", STANOX: "10001", EVENT: "C" },
          { TD: "T2", FROMBERTH: "401", TOBERTH: "500", STANOX: "10002", EVENT: "C" },
        ],
      }),
    ),
  );
  const pair = resolveSmartTiploc(db, "T2", "500", "401");
  assert.equal(pair.tiploc, "BETA");
  const lone = resolveSmartTiploc(db, "T2", "500");
  assert.equal(lone.tiploc, "ALPHA");
  db.close();
});

test("resolveSmartTiploc uses spine hints when to_berth is ambiguous", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE corpus (
      tiploc TEXT PRIMARY KEY,
      stanox TEXT,
      crs TEXT,
      name TEXT
    );
  `);
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("ALPHA", "10001", null, "Alpha");
  db.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("BETA", "10002", null, "Beta");
  ensureSmartTables(db);
  importSmartPayload(
    db,
    parseSmartPayload(
      JSON.stringify({
        SMART: [
          { TD: "T2", TOBERTH: "500", STANOX: "10001", EVENT: "C" },
          { TD: "T2", TOBERTH: "500", STANOX: "10002", EVENT: "A" },
        ],
      }),
    ),
  );
  const hinted = resolveSmartTiploc(db, "T2", "500", null, { hintTiplocs: new Set(["BETA"]) });
  assert.equal(hinted.tiploc, "BETA");
  db.close();
});
