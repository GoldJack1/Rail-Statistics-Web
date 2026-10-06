import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCatalog, openDayDb, upsertCall, upsertService } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { applyTdFrame, ensureTdTables, replayTdEventsForDay } from "./td-apply.js";

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
  assert.equal(row.atp, "16:05");
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
  assert.equal(row.atp, "16:05");
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
  assert.equal(row.atp, "16:05");
  day.close();
});
