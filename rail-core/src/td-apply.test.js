import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCatalog, openDayDb, upsertCall, upsertService } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { applyTdFrame, ensureTdTables, replayTdEventsForDay, tdClock, tdClockPrecise } from "./td-apply.js";

const TODAY = "2026-10-05";
const RID = "202610057115988";

function seedCorpus(dir) {
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)`).run(
    "BROADGR",
    "20001",
    null,
    "Broad Green",
  );
  ensureSmartTables(cat);
  importSmartPayload(
    cat,
    parseSmartPayload(
      JSON.stringify({
        SMART: [{ TD: "T2", FROMBERTH: "401", TOBERTH: "500", STANOX: "20001", EVENT: "C" }],
      }),
    ),
  );
  cat.close();
}

function seedService(dir) {
  const db = openDayDb(dir, TODAY);
  upsertService(db, {
    rid: RID,
    uid: "G15988",
    train_id: "9E18",
    rs_id: null,
    toc: "VT",
    operator_name: "Avanti",
    origin_crs: "EUS",
    origin_name: "Euston",
    destination_crs: "GLC",
    destination_name: "Glasgow Central",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "9E18",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: RID,
    tiploc: "EUSTON",
    crs: "EUS",
    seq: 0,
    is_passing: 0,
    cancelled: 0,
    std: "16:00",
    live_kind: "scheduled",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: RID,
    tiploc: "BROADGR",
    crs: null,
    seq: 1,
    is_passing: 1,
    cancelled: 0,
    wtp: "16:05",
    live_kind: "scheduled",
    actual_source: "orm",
    updated_at: 1,
  });
  db.close();
}

test("TD CA pair mapping fills ORM junction with td actual_source", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-pair-"));
  seedCorpus(dir);
  seedService(dir);
  assert.equal(
    applyTdFrame(
      dir,
      {
        CA_MSG: {
          msg_type: "CA",
          area_id: "T2",
          from: "401",
          to: "500",
          descr: "9E18",
          time: "160530",
        },
      },
      TODAY,
    ),
    true,
  );
  const db = openDayDb(dir, TODAY);
  const row = db.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID);
  assert.equal(row.actual_source, "td");
  assert.equal(row.atp, "16:05:30");
  db.close();
});

test("tdClock treats TD epochs as real UTC and HHMMSS as UK civil", () => {
  assert.equal(tdClock("160530"), "16:05");
  assert.equal(tdClockPrecise("160530"), "16:05:30");
  assert.equal(tdClockPrecise("160500"), "16:05");
  assert.equal(tdClock(String(Date.parse("2026-06-15T15:05:30Z"))), "16:05");
  assert.equal(tdClock(String(Date.parse("2026-01-15T16:05:30Z"))), "16:05");
  assert.equal(tdClock("", Date.parse("2026-06-15T15:05:30Z")), "16:05");
});

test("TD CA epoch during BST is stored as London wall time", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-bst-"));
  seedCorpus(dir);
  seedService(dir);
  applyTdFrame(
    dir,
    {
      CA_MSG: {
        msg_type: "CA",
        area_id: "T2",
        from: "401",
        to: "500",
        descr: "9E18",
        time: String(Date.parse("2026-06-15T15:05:30Z")),
      },
    },
    TODAY,
  );
  const db = openDayDb(dir, TODAY);
  const row = db.prepare(`SELECT atp FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID);
  assert.equal(row.atp, "16:05:30");
  db.close();
});

test("replayTdEventsForDay supports rid filter for ambiguous headcodes", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-rid-replay-"));
  seedCorpus(dir);
  seedService(dir);
  const other = openDayDb(dir, TODAY);
  upsertService(other, {
    rid: "202610058065826",
    uid: "P65826",
    train_id: "9E18",
    rs_id: null,
    toc: "VT",
    operator_name: "Avanti",
    origin_crs: "EUS",
    origin_name: "Euston",
    destination_crs: "GLC",
    destination_name: "Glasgow Central",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "9E18",
    updated_at: 1,
  });
  other.close();

  const db = openDayDb(dir, TODAY);
  ensureTdTables(db);
  const msg = {
    CA_MSG: {
      msg_type: "CA",
      area_id: "T2",
      from: "401",
      to: "500",
      descr: "9E18",
      time: "160530",
    },
  };
  db.prepare(
    `INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("ev-rid", "9E18", "T2", "500", "401", "CA", JSON.stringify(msg), Date.now());
  db.close();

  const out = replayTdEventsForDay(dir, TODAY, { rid: RID });
  assert.equal(out.applied, 1);
  const day = openDayDb(dir, TODAY);
  const row = day.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID);
  assert.equal(row.actual_source, "td");
  assert.equal(row.atp, "16:05:30");
  assert.equal(day.prepare(`SELECT atp FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get("202610058065826"), undefined);
  day.close();
});

test("replayTdEventsForDay re-applies calls after SMART import", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-replay-"));
  const cat = openCatalog(dir);
  ensureSmartTables(cat);
  cat.close();
  seedService(dir);

  const db = openDayDb(dir, TODAY);
  ensureTdTables(db);
  const msg = {
    CA_MSG: {
      msg_type: "CA",
      area_id: "T2",
      from: "401",
      to: "500",
      descr: "9E18",
      time: "160530",
    },
  };
  db.prepare(
    `INSERT INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("ev1", "9E18", "T2", "500", "401", "CA", JSON.stringify(msg), Date.now());
  db.close();

  let day = openDayDb(dir, TODAY);
  assert.equal(day.prepare(`SELECT atp FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID)?.atp, null);
  day.close();

  seedCorpus(dir);
  const out = replayTdEventsForDay(dir, TODAY);
  assert.equal(out.total, 1);
  assert.equal(out.applied, 1);

  day = openDayDb(dir, TODAY);
  const row = day.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID);
  assert.equal(row.actual_source, "td");
  assert.equal(row.atp, "16:05:30");
  day.close();
});

test("a cancel berth step is not a pass on this rid", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-cout-"));
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)`).run(
    "BRLYWJN",
    "18469",
    null,
    "Bradley Wood Junction",
  );
  ensureSmartTables(cat);
  importSmartPayload(
    cat,
    parseSmartPayload(
      JSON.stringify({
        SMART: [{ TD: "Y6", FROMBERTH: "DUMY", TOBERTH: "COUT", STANOX: "18469", EVENT: "C" }],
      }),
    ),
  );
  cat.close();
  const db = openDayDb(dir, TODAY);
  upsertService(db, {
    rid: RID,
    uid: "L89455",
    train_id: "2J68",
    rs_id: null,
    toc: "NT",
    operator_name: "Northern",
    origin_crs: "LDS",
    origin_name: "Leeds",
    destination_crs: "BDI",
    destination_name: "Bradford Interchange",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "OO",
    headcode: "2J68",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: RID,
    tiploc: "BRLYWJN",
    crs: null,
    seq: 11,
    is_passing: 1,
    cancelled: 0,
    wtp: "15:19",
    live_kind: "scheduled",
    updated_at: 1,
  });
  db.close();
  applyTdFrame(
    dir,
    {
      CA_MSG: {
        msg_type: "CA",
        area_id: "Y6",
        from: "DUMY",
        to: "COUT",
        descr: "2J68",
        time: "145420",
      },
    },
    TODAY,
  );
  const day = openDayDb(dir, TODAY);
  const row = day.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'BRLYWJN'`).get(RID);
  assert.equal(row.atp ?? null, null);
  assert.notEqual(row.actual_source, "td");
  day.close();
});

test("a headcode step from another working is not written onto this rid", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-early-"));
  seedCorpus(dir);
  seedService(dir);
  applyTdFrame(
    dir,
    {
      CA_MSG: {
        msg_type: "CA",
        area_id: "T2",
        from: "401",
        to: "500",
        descr: "9E18",
        time: "090715",
      },
    },
    TODAY,
  );
  const db = openDayDb(dir, TODAY);
  const row = db.prepare(`SELECT atp FROM calls WHERE rid = ? AND tiploc = 'BROADGR'`).get(RID);
  assert.equal(row.atp ?? null, null);
  db.close();
});
