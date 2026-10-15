import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dropUnreportedOrmPasses, overlayTdOnCalls } from "./query-enrich.js";
import { openDayDb } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dropUnreportedOrmPasses keeps passenger CRS ORM stations and drops yards", () => {
  const catalog = new DatabaseSync(":memory:");
  catalog.exec(`CREATE TABLE corpus (tiploc TEXT PRIMARY KEY, stanox TEXT, crs TEXT, name TEXT)`);
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("EGRFRTH", null, "EGF", "East Garforth");
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("TYN", null, "TYN", "Tyne Yard");
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("HOLBJCN", null, null, "Holbeck Junction");
  const calls = [
    { tiploc: "LEEDS", actual_source: null, atd: "10:01" },
    { tiploc: "HOLBJCN", actual_source: "orm", wtp: "10:02" },
    { tiploc: "EGRFRTH", actual_source: "orm", crs: "EGF", wtp: "10:03" },
    { tiploc: "TYN", actual_source: "orm", crs: "TYN", wtp: "10:04" },
  ];
  const out = dropUnreportedOrmPasses(calls, catalog);
  assert.deepEqual(
    out.map((c) => c.tiploc),
    ["LEEDS", "EGRFRTH"],
  );
  catalog.close();
});

test("overlayTdOnCalls fills empty passing atp from td_events", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('1', '9M13', 'Y2', '1234', '0000', 'CA', 'BIRTLEY', '12345', '{"CA_MSG":{"time":"131200","msg_type":"CA"}}', 1)
  `);
  const calls = [
    { tiploc: "BIRTLEY", is_passing: 1, wtp: "13:07", atp: null },
    { tiploc: "DURHAM", is_passing: 0, atd: "13:23" },
  ];
  const out = overlayTdOnCalls(db, calls, "9M13");
  assert.equal(out[0].atp, "13:12");
  assert.equal(out[0].actual_source, "td");
  assert.equal(out[1].atd, "13:23");
  db.close();
});

test("overlayTdOnCalls maps null-tiploc events via SMART", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('2', '9M13', 'Y2', 'HOLB', '0001', 'CA', NULL, NULL, '{"CA_MSG":{"time":"130400","msg_type":"CA"}}', 2)
  `);
  const catalog = new DatabaseSync(":memory:");
  catalog.exec(`CREATE TABLE corpus (tiploc TEXT PRIMARY KEY, stanox TEXT, crs TEXT, name TEXT)`);
  catalog.prepare(`INSERT INTO corpus VALUES (?, ?, ?, ?)`).run("HOLBJCN", "16421", null, "Holbeck Junction");
  ensureSmartTables(catalog);
  importSmartPayload(
    catalog,
    parseSmartPayload(
      JSON.stringify({
        SMART: [{ TD: "Y2", FROMBERTH: "0001", TOBERTH: "HOLB", STANOX: "16421", EVENT: "C", PLATFORM: "" }],
      }),
    ),
  );
  const calls = [{ tiploc: "HOLBJCN", is_passing: 1, wtp: "13:04", atp: null }];
  const out = overlayTdOnCalls(db, calls, "9M13", catalog);
  assert.equal(out[0].atp, "13:04");
  assert.equal(out[0].actual_source, "td");
  db.close();
  catalog.close();
});
