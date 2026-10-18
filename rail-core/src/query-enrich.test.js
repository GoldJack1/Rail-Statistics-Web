import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyLiveToInferred, carryRunningLateness, dropUnreportedOrmPasses, insertReportedPasses, insertSchedulePasses, insertSegmentJunctions, overlayTdOnCalls, reportsForService, settleUnreportedPasses } from "./query-enrich.js";
import { openDayDb } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("an inferred pass behind a real report does not keep an expected time", () => {
  const out = settleUnreportedPasses([
    { tiploc: "DLTNN", actual_source: "inferred", etp: "19:34", live_kind: "est", wtp: "19:33" },
    { tiploc: "DLTN", actual_source: "trust", atd: "19:36", wtd: "19:35" },
    { tiploc: "AHEAD", actual_source: "inferred", etp: "19:40", live_kind: "est", wtp: "19:40" },
  ]);
  assert.equal(out[0].etp, null);
  assert.equal(out[0].live_kind, null);
  assert.equal(out[2].etp, "19:40");
});

test("insertReportedPasses places a feed location by time and leaves scheduled rows", () => {
  const calls = [
    { tiploc: "MARSDEN", is_passing: 1, wtp: "18:19", atp: "18:31", actual_source: "trust" },
    { tiploc: "HUDDERS", is_passing: 0, wtd: "18:30", atd: "18:40", actual_source: "trust" },
  ];
  const out = insertReportedPasses(calls, [
    { tiploc: "SLAITHW", crs: "SWT", clock: "18:34", minute: 18 * 60 + 34, source: "td" },
    { tiploc: "MARSDEN", clock: "18:31", minute: 18 * 60 + 31, source: "td" },
  ]);
  assert.deepEqual(
    out.map((c) => c.tiploc),
    ["MARSDEN", "SLAITHW", "HUDDERS"],
  );
  assert.equal(out[1].atp, "18:34");
  assert.equal(out[1].actual_source, "td");
  assert.equal(out[0].actual_source, "trust");
});

test("reportsForService ignores another train on the same headcode and a point off the line", () => {
  const calls = [
    { tiploc: "DIGGLEJ", is_passing: 1, atp: "18:27" },
    { tiploc: "MARSDEN", is_passing: 1, atp: "18:31" },
    { tiploc: "NCL", is_passing: 0, wta: "20:24" },
  ];
  const coords = new Map([
    ["DIGGLEJ", { e: 0, n: 0 }],
    ["MARSDEN", { e: 8000, n: 0 }],
    ["NCL", { e: 100000, n: 0 }],
    ["UPRMILL", { e: 4000, n: 40 }],
    ["DEANLNE", { e: -30000, n: 0 }],
  ]);
  const out = reportsForService(
    calls,
    [
      { tiploc: "DALS", clock: "09:43", minute: 9 * 60 + 43, source: "td" },
      { tiploc: "DEANLNE", clock: "18:27", minute: 18 * 60 + 27, source: "td" },
      { tiploc: "UPRMILL", clock: "18:29", minute: 18 * 60 + 29, source: "td" },
    ],
    coords,
  );
  assert.deepEqual(out.map((row) => row.tiploc), ["UPRMILL"]);
});

test("carryRunningLateness holds the last real delay and stays in order", () => {
  const out = carryRunningLateness([
    { tiploc: "SLAITHW", is_passing: 1, wtp: "19:53", atp: "20:00", actual_source: "td" },
    { tiploc: "SPWDJN", is_passing: 1, atp: "20:06", actual_source: "inferred" },
    { tiploc: "HUDDERS", is_passing: 0, wta: "19:58", wtd: "20:01", ata: "20:05", atd: "20:06", actual_source: "trust" },
    { tiploc: "HOLBJCN", is_passing: 1, wtp: "20:19", actual_source: "inferred" },
    { tiploc: "LEEDS", is_passing: 0, wta: "20:22", wtd: "20:27", eta: "20:22", etd: "20:27" },
    { tiploc: "NCL", is_passing: 0, wta: "21:26", eta: "21:31" },
  ]);
  assert.equal(out[0].atp, "20:00");
  assert.equal(out[1].atp, null);
  assert.equal(out[1].etp, "20:05");
  assert.equal(out[2].atd, "20:06");
  assert.equal(out[3].etp, "20:24");
  assert.equal(out[4].etd, "20:32");
  assert.equal(out[4].eta, "20:27");
  assert.equal(out[5].eta, "21:31");
});

test("dropUnreportedOrmPasses keeps stations and named junctions, and drops yards", () => {
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
    ["LEEDS", "HOLBJCN", "EGRFRTH"],
  );
  catalog.close();
});

test("inferred pass behind a later actual takes that lateness", () => {
  const out = applyLiveToInferred(null, [
    { tiploc: "A", is_passing: 0, wtd: "15:03", atd: "15:02" },
    { tiploc: "B", is_passing: 1, wtp: "15:06", etp: "15:06", actual_source: "inferred" },
    { tiploc: "C", is_passing: 1, wtp: "15:07", atp: "15:05", actual_source: "td" },
  ], null);
  assert.equal(out[1].atp, "15:04");
  assert.equal(out[1].live_kind, "actual");
  assert.equal(out[1].actual_source, "inferred");
});

test("a junction other trains take is kept when it sits between two calls", () => {
  const coords = new Map([
    ["MIRFEJN", { e: 0, n: 0 }],
    ["THHLNWJ", { e: 500, n: 10 }],
    ["RTHP", { e: 1000, n: 0 }],
    ["HORBRYJ", { e: 500, n: 5000 }],
  ]);
  const sequences = [
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "THHLNWJ", "HORBRYJ"],
    ["MIRFEJN", "HORBRYJ"],
  ];
  const out = insertSegmentJunctions(
    [
      { tiploc: "MIRFEJN", wtp: "13:54" },
      { tiploc: "RTHP", wtp: "13:56" },
    ],
    sequences,
    coords,
  );
  assert.deepEqual(out.map((c) => c.tiploc), ["MIRFEJN", "THHLNWJ", "RTHP"]);
  assert.equal(out[1].actual_source, "inferred");
  assert.equal(out[1].wtp, "13:55");
});

test("schedule pass uses the path that also reaches the next stop", () => {
  const fast = ["EUSTON", "WATFDJ", "RUGBY"];
  const slow = ["EUSTON", "SHMPSTD", "KILBNHR", "WATFDJ"];
  const wcml = ["EUSTON", "BUSHEY", "WATFDJ", "RUGBY"];
  const calls = insertSchedulePasses(
    [
      { tiploc: "EUSTON", wtd: "10:00" },
      { tiploc: "WATFDJ", wta: "10:20" },
      { tiploc: "RUGBY", wta: "10:50" },
    ],
    [fast, slow, wcml, wcml, wcml],
  );
  assert.deepEqual(calls.map((c) => c.tiploc), ["EUSTON", "BUSHEY", "WATFDJ", "RUGBY"]);
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

test("overlayTdOnCalls keeps TD seconds on the same minute", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-15");
  db.exec(`
    INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
    VALUES ('3', '9M13', 'Y2', '1234', '0000', 'CA', 'BIRTLEY', '12345', '{"CA_MSG":{"time":"131215","msg_type":"CA"}}', 3)
  `);
  const calls = [
    { tiploc: "BIRTLEY", is_passing: 1, wtp: "13:07", atp: "13:12", actual_source: "trust" },
    { tiploc: "DURHAM", is_passing: 0, atd: "13:13" },
  ];
  const out = overlayTdOnCalls(db, calls, "9M13");
  assert.equal(out[0].atp, "13:12:15");
  assert.equal(out[0].actual_source, "trust");
  assert.equal(out[1].atd, "13:13");
  db.close();
});
