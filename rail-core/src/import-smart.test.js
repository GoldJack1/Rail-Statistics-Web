import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  ensureSmartTables,
  importSmartPayload,
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
