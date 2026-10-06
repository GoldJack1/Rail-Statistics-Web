import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ridVisibleOnBoard } from "./calendar-day.js";
import { cifImportDayYmds } from "./cif-schedule.js";
import { openCatalog, openDayDb, upsertCall, upsertService } from "./db.js";
import { ensureSmartTables, importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { applyTdFrame } from "./td-apply.js";
import { applyTrustFrame } from "./trust-apply.js";
import { applyVstpFrame } from "./vstp-apply.js";
import { writeDaysForRid } from "./nrod-write-days.js";

const TODAY = "2026-10-04";
const TOMORROW = "2026-10-05";
const TOMORROW_RID = "202610057116021";
const TODAY_RID = "202610047116021";
const UID = "G16021";
const SMART = JSON.stringify({
  SMART: [
    {
      TD: "Y2",
      FROMBERTH: "A123",
      TOBERTH: "HOLB",
      STANOX: "16421",
      EVENT: "C",
      PLATFORM: "",
    },
  ],
});

function svc(rid, extra = {}) {
  return {
    rid,
    uid: UID,
    train_id: "1P76",
    rs_id: null,
    toc: "TP",
    operator_name: "TP",
    origin_crs: "LDS",
    origin_name: "Leeds",
    destination_crs: "DEW",
    destination_name: "Dewsbury",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "1P76",
    updated_at: 1,
    ...extra,
  };
}

function seedService(dir, ymd, rid, extra = {}) {
  const { atd, cancelled, ...svcExtra } = extra;
  const db = openDayDb(dir, ymd);
  upsertService(db, svc(rid, { ...svcExtra, cancelled: cancelled ? 1 : 0 }));
  upsertCall(db, {
    rid,
    tiploc: "LEEDS",
    crs: "LDS",
    seq: 0,
    is_passing: 0,
    cancelled: 0,
    sta: null,
    std: "15:45",
    live_kind: "scheduled",
    updated_at: 1,
  });
  upsertCall(db, {
    rid,
    tiploc: "DWBY",
    crs: "DEW",
    seq: 1,
    is_passing: 0,
    cancelled: cancelled ? 1 : 0,
    sta: "15:55",
    std: null,
    live_kind: atd ? "actual" : "scheduled",
    atd: atd || null,
    actual_source: atd ? "darwin" : null,
    updated_at: 1,
  });
  db.close();
}

function seedCorpus(dir) {
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)`).run("MIRFD", "85002", null, "Mirfield");
  cat.prepare(`INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)`).run("HOLBJCN", "16421", null, "Holbeck Junction");
  cat.prepare(`INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)`).run("HUDDS", "85001", "HUD", "Huddersfield");
  cat.prepare(`INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)`).run("LEEDS", "LDS", "Leeds");
  cat.prepare(`INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)`).run("DWBY", "DEW", "Dewsbury");
  ensureSmartTables(cat);
  importSmartPayload(cat, parseSmartPayload(SMART));
  cat.close();
}

function trustPass() {
  return {
    header: { msg_type: "0003" },
    body: {
      event_type: "PASS",
      train_id: "201P76MZ04",
      train_uid: UID,
      loc_stanox: "85002",
      actual_timestamp: "1790802300000",
      planned_timestamp: "1790802240000",
    },
  };
}

test("write days: tomorrow-SSD RID already on today overlays both files", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-both-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TOMORROW_RID);
  seedService(dir, TOMORROW, TOMORROW_RID);
  assert.deepEqual(writeDaysForRid(dir, TODAY, TOMORROW_RID).sort(), [TODAY, TOMORROW]);
  applyTrustFrame(dir, { header: { msg_type: "0001" }, body: { train_id: "201P76MZ04", train_uid: UID, toc_id: "20" } }, TODAY);
  assert.equal(applyTrustFrame(dir, trustPass(), TODAY), true);
  for (const day of [TODAY, TOMORROW]) {
    const db = openDayDb(dir, day);
    const row = db.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'MIRFD'`).get(TOMORROW_RID);
    assert.equal(row?.actual_source, "trust");
    assert.equal(row?.atp?.length, 5);
    db.close();
  }
  assert.equal(
    applyVstpFrame(
      dir,
      {
        VSTPCIFMsgV1: {
          schedule: {
            CIF_train_uid: UID,
            CIF_stp_indicator: "O",
            schedule_start_date: TOMORROW,
            schedule_segment: [
              {
                signalling_id: "1P76",
                schedule_location: [
                  { tiploc_code: "LEEDS", public_departure: "1545", departure: "1545" },
                  { tiploc_code: "HOLBJCN", pass: "1546" },
                  { tiploc_code: "DWBY", public_arrival: "1555", arrival: "1555" },
                ],
              },
            ],
          },
        },
      },
      TODAY,
    ),
    true,
  );
  assert.equal(applyTdFrame(dir, { CA_MSG: { msg_type: "CA", area_id: "Y2", from: "A123", to: "HOLB", descr: "1P76", time: "153045" } }, TODAY), true);
  const today = openDayDb(dir, TODAY);
  const tdCall = today.prepare(`SELECT actual_source, is_passing FROM calls WHERE rid = ? AND tiploc = 'HOLBJCN'`).get(TOMORROW_RID);
  assert.equal(tdCall.actual_source, "td");
  assert.equal(tdCall.is_passing, 1);
  today.close();
});

test("write days: tomorrow-only RID stays off today's CIS file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-ssd-"));
  seedCorpus(dir);
  seedService(dir, TOMORROW, TOMORROW_RID);
  assert.deepEqual(writeDaysForRid(dir, TODAY, TOMORROW_RID), [TOMORROW]);
  applyTrustFrame(dir, { header: { msg_type: "0001" }, body: { train_id: "201P76MZ04", train_uid: UID, toc_id: "20" } }, TODAY);
  applyTrustFrame(dir, trustPass(), TODAY);
  const today = openDayDb(dir, TODAY);
  assert.equal(today.prepare(`SELECT COUNT(*) n FROM calls WHERE rid = ?`).get(TOMORROW_RID).n, 0);
  today.close();
  const tom = openDayDb(dir, TOMORROW);
  const row = tom.prepare(`SELECT atp, actual_source FROM calls WHERE rid = ? AND tiploc = 'MIRFD'`).get(TOMORROW_RID);
  assert.equal(row?.actual_source, "trust");
  tom.close();
  assert.equal(ridVisibleOnBoard(TOMORROW_RID, "15:45", TODAY), false);
});

test("TRUST 0002/0005/0006/0007 apply; 0004 is a no-op on calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "trust-types-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TODAY_RID, { atd: "15:56" });
  applyTrustFrame(dir, { header: { msg_type: "0001" }, body: { train_id: "201P76MZ04", train_uid: UID, toc_id: "20" } }, TODAY);

  const before = openDayDb(dir, TODAY);
  const dew = before.prepare(`SELECT atd FROM calls WHERE rid = ? AND tiploc = 'DWBY'`).get(TODAY_RID);
  assert.equal(dew.atd, "15:56");
  before.close();

  assert.equal(applyTrustFrame(dir, { header: { msg_type: "0004" }, body: { train_id: "xxxx", loc_stanox: "85002" } }, TODAY), true);
  let db = openDayDb(dir, TODAY);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM calls WHERE rid = ?`).get(TODAY_RID).n, 2);
  assert.equal(db.prepare(`SELECT cancelled FROM services WHERE rid = ?`).get(TODAY_RID).cancelled, 0);
  db.close();

  assert.equal(
    applyTrustFrame(dir, { header: { msg_type: "0002" }, body: { train_id: "201P76MZ04", train_uid: UID, canx_reason_code: "YI" } }, TODAY),
    true,
  );
  db = openDayDb(dir, TODAY);
  const cancelled = db.prepare(`SELECT cancelled, cancel_reason, destination_crs FROM services WHERE rid = ?`).get(TODAY_RID);
  assert.equal(cancelled.cancelled, 1);
  assert.match(cancelled.cancel_reason, /^TRUST:0002/);
  assert.equal(db.prepare(`SELECT atd FROM calls WHERE rid = ? AND tiploc = 'DWBY'`).get(TODAY_RID).atd, "15:56");
  db.close();

  assert.equal(applyTrustFrame(dir, { header: { msg_type: "0005" }, body: { train_id: "201P76MZ04", train_uid: UID } }, TODAY), true);
  db = openDayDb(dir, TODAY);
  assert.equal(db.prepare(`SELECT cancelled FROM services WHERE rid = ?`).get(TODAY_RID).cancelled, 0);
  db.close();

  const destBefore = openDayDb(dir, TODAY).prepare(`SELECT destination_crs FROM services WHERE rid = ?`).get(TODAY_RID);
  assert.equal(destBefore.destination_crs, "DEW");
  assert.equal(
    applyTrustFrame(
      dir,
      { header: { msg_type: "0006" }, body: { train_id: "201P76MZ04", train_uid: UID, loc_stanox: "85001" } },
      TODAY,
    ),
    true,
  );
  db = openDayDb(dir, TODAY);
  const origin = db.prepare(`SELECT origin_crs, origin_name, destination_crs FROM services WHERE rid = ?`).get(TODAY_RID);
  assert.equal(origin.origin_crs, "HUD");
  assert.equal(origin.origin_name, "Huddersfield");
  assert.equal(origin.destination_crs, "DEW");
  assert.ok(db.prepare(`SELECT tiploc FROM calls WHERE rid = ? AND tiploc = 'HUDDS'`).get(TODAY_RID));
  db.close();

  assert.equal(
    applyTrustFrame(
      dir,
      { header: { msg_type: "0007" }, body: { train_id: "201P76MZ04", train_uid: UID, revised_train_id: "201P76NZ04" } },
      TODAY,
    ),
    true,
  );
  applyTrustFrame(
    dir,
    {
      header: { msg_type: "0003" },
      body: {
        event_type: "DEPARTURE",
        train_id: "201P76NZ04",
        loc_stanox: "85001",
        actual_timestamp: "1790802300000",
      },
    },
    TODAY,
  );
  db = openDayDb(dir, TODAY);
  const mapped = db.prepare(`SELECT uid FROM trust_trains WHERE train_id = '201P76NZ04'`).get();
  assert.equal(mapped.uid, UID);
  assert.equal(db.prepare(`SELECT train_id FROM trust_trains WHERE train_id = '201P76MZ04'`).get(), undefined);
  assert.equal(db.prepare(`SELECT atd FROM calls WHERE rid = ? AND tiploc = 'HUDDS'`).get(TODAY_RID).atd?.length, 5);
  db.close();
});

test("Darwin CIS cancel is kept over TRUST 0002/0005", () => {
  const dir = mkdtempSync(join(tmpdir(), "darwin-cancel-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TODAY_RID, { cancelled: 1, atd: "15:56" });
  const db0 = openDayDb(dir, TODAY);
  db0.prepare(`UPDATE services SET cancelled = 1, cancel_reason = NULL WHERE rid = ?`).run(TODAY_RID);
  db0.close();
  applyTrustFrame(dir, { header: { msg_type: "0001" }, body: { train_id: "201P76MZ04", train_uid: UID, toc_id: "20" } }, TODAY);
  applyTrustFrame(dir, { header: { msg_type: "0002" }, body: { train_id: "201P76MZ04", train_uid: UID, canx_reason_code: "YI" } }, TODAY);
  applyTrustFrame(dir, { header: { msg_type: "0005" }, body: { train_id: "201P76MZ04", train_uid: UID } }, TODAY);
  const db = openDayDb(dir, TODAY);
  const row = db.prepare(`SELECT cancelled, cancel_reason FROM services WHERE rid = ?`).get(TODAY_RID);
  assert.equal(row.cancelled, 1);
  assert.equal(row.cancel_reason, null);
  assert.equal(db.prepare(`SELECT atd FROM calls WHERE rid = ? AND tiploc = 'DWBY'`).get(TODAY_RID).atd, "15:56");
  db.close();
});

test("TD unique headcode + SMART writes a working pass; ambiguous headcode does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-smart-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TODAY_RID);
  assert.equal(
    applyTdFrame(dir, { CA_MSG: { msg_type: "CA", area_id: "Y2", from: "A123", to: "HOLB", descr: "1P76", time: "153045" } }, TODAY),
    true,
  );
  let db = openDayDb(dir, TODAY);
  const pass = db.prepare(`SELECT is_passing, actual_source FROM calls WHERE rid = ? AND tiploc = 'HOLBJCN'`).get(TODAY_RID);
  assert.equal(pass.is_passing, 1);
  assert.equal(pass.actual_source, "td");
  db.close();

  const amb = mkdtempSync(join(tmpdir(), "td-amb-"));
  seedCorpus(amb);
  seedService(amb, TODAY, TODAY_RID);
  seedService(amb, TODAY, "202610047116099", { uid: "G16099", train_id: "1P76", headcode: "1P76" });
  const callsBefore = openDayDb(amb, TODAY).prepare(`SELECT COUNT(*) n FROM calls`).get().n;
  assert.equal(
    applyTdFrame(amb, { CA_MSG: { msg_type: "CA", area_id: "Y2", from: "A123", to: "HOLB", descr: "1P76", time: "153045" } }, TODAY),
    true,
  );
  db = openDayDb(amb, TODAY);
  assert.equal(db.prepare(`SELECT berth FROM td_trains WHERE headcode = '1P76'`).get().berth, "HOLB");
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM calls`).get().n, callsBefore);
  db.close();
});

test("TD SF/SG/CT never create calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-s-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TODAY_RID);
  const before = openDayDb(dir, TODAY).prepare(`SELECT COUNT(*) n FROM calls`).get().n;
  assert.equal(applyTdFrame(dir, { SF_MSG: { msg_type: "SF", area_id: "Y2", descr: "1P76" } }, TODAY), false);
  assert.equal(applyTdFrame(dir, { SG_MSG: { msg_type: "SG", area_id: "Y2", descr: "1P76" } }, TODAY), false);
  assert.equal(applyTdFrame(dir, { CT_MSG: { msg_type: "CT", area_id: "Y2", descr: "1P76" } }, TODAY), false);
  const db = openDayDb(dir, TODAY);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM calls`).get().n, before);
  db.close();
});

test("VSTP Create overlays UID already on the day file; CIF still skips Darwin day", () => {
  const dir = mkdtempSync(join(tmpdir(), "vstp-uid-"));
  seedCorpus(dir);
  seedService(dir, TODAY, TODAY_RID);
  const frame = {
    VSTPCIFMsgV1: {
      schedule: {
        CIF_train_uid: UID,
        CIF_stp_indicator: "O",
        schedule_start_date: TODAY,
        schedule_segment: [
          {
            signalling_id: "1P76",
            schedule_location: [
              { tiploc_code: "LEEDS", public_departure: "1545", departure: "1545" },
              { tiploc_code: "HOLBJCN", pass: "1546" },
              { tiploc_code: "DWBY", public_arrival: "1555", arrival: "1555" },
            ],
          },
        ],
      },
    },
  };
  assert.equal(applyVstpFrame(dir, frame, TODAY), true);
  const db = openDayDb(dir, TODAY);
  const holb = db.prepare(`SELECT is_passing, wtp FROM calls WHERE rid = ? AND tiploc = 'HOLBJCN'`).get(TODAY_RID);
  assert.equal(holb.is_passing, 1);
  assert.equal(holb.wtp, "15:46");
  db.close();
  assert.deepEqual(cifImportDayYmds(TODAY, 1, TODAY), [TOMORROW]);
});
