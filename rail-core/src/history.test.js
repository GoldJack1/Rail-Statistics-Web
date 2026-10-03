import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hhmm, openCatalog, openDayDb, operatingDayYmd, upsertCall, upsertService } from "./db.js";
import { applyHspDetails } from "./hsp-apply.js";
import { ridsNeedingHspSeal } from "./hsp-seal-rids.js";
import { trustMessages } from "./trust-parse.js";
import { applyTrustFrame } from "./trust-apply.js";
import { clockAfter, maskCallAsOf, maskTrustOverlay } from "./replay-at.js";
import { computeServiceLocation } from "./location.js";

test("hhmm accepts HSP hhmm and TRUST epoch ms", () => {
  assert.equal(hhmm("1627"), "16:27");
  assert.equal(hhmm(1790802300000)?.length, 5);
});

test("trustMessages unwraps NROD arrays", () => {
  const msgs = trustMessages(JSON.stringify([{ header: { msg_type: "0003" }, body: { event_type: "PASS" } }]));
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body.event_type, "PASS");
});

test("HSP details fill public stops and leave a pass row alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "hsp-"));
  const db = openDayDb(dir, "2026-09-29");
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)`).run("DWBY", "DEW", "Dewsbury");
  cat.prepare(`INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)`).run("LDS", "LDS", "Leeds");
  cat.prepare(`INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)`).run("MCHN", "MCV", "Manchester Victoria");
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES ('202609297115813', '711581', NULL, NULL, 'TP', 'TP', 'SCA', NULL, 'MCV', NULL, NULL, 'passenger', 0, NULL, NULL, 0, NULL, NULL, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, sta, std, wtp, ata, atd, atp, live_kind, actual_source, updated_at)
     VALUES
     ('202609297115813', 'LDS', 'LDS', 0, 0, 0, '16:13', '16:16', NULL, NULL, NULL, NULL, 'scheduled', NULL, 1),
     ('202609297115813', 'DWBY', NULL, 1, 0, 0, '16:26', '16:27', NULL, NULL, NULL, NULL, 'scheduled', NULL, 1),
     ('202609297115813', 'MIRFD', NULL, 2, 1, 0, NULL, NULL, '16:31', NULL, NULL, NULL, 'scheduled', NULL, 1)`,
  ).run();
  applyHspDetails(db, cat, {
    serviceAttributesDetails: {
      rid: "202609297115813",
      toc_code: "TP",
      locations: [
        { location: "LDS", gbtt_pta: "1613", gbtt_ptd: "1616", actual_ta: "1620", actual_td: "1625", late_canc_reason: "576" },
        { location: "DEW", gbtt_pta: "1626", gbtt_ptd: "1627", actual_ta: "1635", actual_td: "1636", late_canc_reason: "576" },
        { location: "MCV", gbtt_pta: "1723", gbtt_ptd: "", actual_ta: "1724", actual_td: "", late_canc_reason: "576" },
      ],
    },
  }, "2026-09-29");
  const dew = db.prepare(`SELECT ata, atd, actual_source, is_passing FROM calls WHERE tiploc='DWBY'`).get();
  assert.equal(dew.atd, "16:36");
  assert.equal(dew.actual_source, "hsp");
  assert.equal(dew.is_passing, 0);
  applyHspDetails(
    db,
    cat,
    {
      serviceAttributesDetails: {
        rid: "hsp-other-rid",
        toc_code: "TP",
        locations: [{ location: "LDS", gbtt_pta: "1613", gbtt_ptd: "1616", actual_ta: "1621", actual_td: "1626" }],
      },
    },
    "2026-09-29",
    "202609297115813",
  );
  const lds = db.prepare(`SELECT ata, atd FROM calls WHERE crs='LDS'`).get();
  assert.equal(lds.ata, "16:20");
  assert.equal(lds.atd, "16:25");
  const pass = db.prepare(`SELECT atp, is_passing, actual_source FROM calls WHERE tiploc='MIRFD'`).get();
  assert.equal(pass.is_passing, 1);
  assert.equal(pass.atp, null);
  db.close();
  cat.close();
});

test("HSP seal skips forecast-only RIDs, keeps Darwin holes and timetable-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "hsp-rids-"));
  const db = openDayDb(dir, "2026-10-01");
  const svc = (rid) =>
    db
      .prepare(
        `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
          destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
          is_charter, category, headcode, updated_at)
         VALUES (?, NULL, NULL, NULL, 'TP', 'TP', 'LDS', NULL, 'MCV', NULL, NULL, 'passenger', 0, NULL, NULL, 0, NULL, NULL, 1)`,
      )
      .run(rid);
  svc("rid-darwin-hole");
  svc("rid-forecast-only");
  svc("rid-tt-only");
  svc("rid-already-miss");
  db.prepare(
    `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, sta, std, ata, atd, atp, eta, etd, live_kind, actual_source, updated_at)
     VALUES
     ('rid-darwin-hole', 'LDS', 'LDS', 0, 0, 0, '16:13', '16:16', '16:14', '16:16', NULL, NULL, NULL, 'actual', 'darwin', 1),
     ('rid-darwin-hole', 'DWBY', 'DEW', 1, 0, 0, '16:26', '16:27', NULL, NULL, NULL, NULL, NULL, 'scheduled', NULL, 1),
     ('rid-forecast-only', 'LDS', 'LDS', 0, 0, 0, '16:13', '16:16', NULL, NULL, NULL, '16:14', '16:16', 'forecast', NULL, 1),
     ('rid-tt-only', 'LDS', 'LDS', 0, 0, 0, '16:13', '16:16', NULL, NULL, NULL, NULL, NULL, 'scheduled', NULL, 1),
     ('rid-already-miss', 'LDS', 'LDS', 0, 0, 0, '16:13', '16:16', NULL, NULL, NULL, NULL, NULL, 'scheduled', NULL, 1)`,
  ).run();
  db.prepare(`INSERT INTO meta (key, value) VALUES ('hsp_miss_rid-already-miss', '2026-10-01')`).run();
  const rids = ridsNeedingHspSeal(db);
  assert.deepEqual([...rids].sort(), ["rid-darwin-hole", "rid-tt-only"]);
  db.close();
});

test("TRUST PASS writes atp onto a new reporting point", () => {
  const dir = mkdtempSync(join(tmpdir(), "trust-"));
  const db = openDayDb(dir, "2026-09-30");
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (stanox, tiploc, crs, name) VALUES (?, ?, ?, ?)`).run("85002", "MIRFD", null, "Mirfield");
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES ('r1', 'C00498', '1P27', NULL, 'TP', 'TP', 'SCA', NULL, 'MCV', NULL, NULL, 'passenger', 0, NULL, NULL, 0, NULL, '1P27', 1)`,
  ).run();
  db.close();
  cat.close();
  applyTrustFrame(
    dir,
    {
      header: { msg_type: "0001" },
      body: { train_id: "871P27MZ30", train_uid: "C00498", toc_id: "20" },
    },
    "2026-09-30",
  );
  applyTrustFrame(
    dir,
    {
      header: { msg_type: "0003" },
      body: {
        event_type: "PASS",
        train_id: "871P27MZ30",
        loc_stanox: "85002",
        actual_timestamp: "1790802300000",
        planned_timestamp: "1790802240000",
      },
    },
    "2026-09-30",
    { overlayCalls: true },
  );
  const day = openDayDb(dir, "2026-09-30");
  const row = day.prepare(`SELECT atp, is_passing, actual_source FROM calls WHERE tiploc='MIRFD'`).get();
  assert.equal(row.is_passing, 1);
  assert.equal(row.actual_source, "trust");
  assert.equal(row.atp?.length, 5);
  const ev = day.prepare(`SELECT json FROM trust_events WHERE json LIKE '%PASS%' LIMIT 1`).get();
  assert.ok(ev?.json?.includes("PASS"));
  day.close();
});

test("TRUST does not glue two different 2N57s together", () => {
  const dir = mkdtempSync(join(tmpdir(), "trust-2n57-"));
  const db = openDayDb(dir, "2026-09-30");
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (stanox, tiploc, crs, name) VALUES (?, ?, ?, ?)`).run("23547", "BRKNHDN", "BKN", "Birkenhead North");
  for (const s of [
    ["nt1", "P24061", "NT", "Rochdale", "Clitheroe", "RCHDALE", "RCD"],
    ["me1", "G77547", "ME", "New Brighton", "Wirral", "BRKNHDN", "BKN"],
  ]) {
    db.prepare(
      `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
        destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
        is_charter, category, headcode, updated_at)
       VALUES (?, ?, '2N57', NULL, ?, ?, NULL, ?, NULL, ?, NULL, 'passenger', 0, NULL, NULL, 0, NULL, '2N57', 1)`,
    ).run(s[0], s[1], s[2], s[2], s[3], s[4]);
    db.prepare(
      `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, sta, std, live_kind, actual_source, updated_at)
       VALUES (?, ?, ?, 0, 0, 0, NULL, '21:52', 'scheduled', NULL, 1)`,
    ).run(s[0], s[5], s[6]);
  }
  db.close();
  cat.close();
  applyTrustFrame(
    dir,
    {
      header: { msg_type: "0003" },
      body: {
        event_type: "DEPARTURE",
        train_id: "482N57MZ30",
        toc_id: "48",
        loc_stanox: "23547",
        actual_timestamp: "1790802300000",
      },
    },
    "2026-09-30",
    { overlayCalls: true },
  );
  const day = openDayDb(dir, "2026-09-30");
  assert.equal(day.prepare(`SELECT COUNT(*) n FROM calls WHERE rid='nt1'`).get().n, 1);
  const me = day.prepare(`SELECT atd, actual_source FROM calls WHERE rid='me1' AND tiploc='BRKNHDN'`).get();
  assert.equal(me.actual_source, "trust");
  assert.ok(me.atd);
  day.close();
});

test("TRUST overlays call actuals on the live day", () => {
  const ymd = operatingDayYmd();
  const dir = mkdtempSync(join(tmpdir(), "trust-live-"));
  const db = openDayDb(dir, ymd);
  const cat = openCatalog(dir);
  cat.prepare(`INSERT INTO corpus (stanox, tiploc, crs, name) VALUES (?, ?, ?, ?)`).run("23547", "BRKNHDN", "BKN", "Birkenhead North");
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES ('me1', 'G77547', '2N57', NULL, 'ME', 'ME', NULL, 'New Brighton', NULL, 'Wirral', NULL, 'passenger', 0, NULL, NULL, 0, NULL, '2N57', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, sta, std, live_kind, actual_source, updated_at)
     VALUES ('me1', 'BRKNHDN', 'BKN', 0, 0, 0, NULL, '21:52', 'scheduled', NULL, 1)`,
  ).run();
  db.close();
  cat.close();
  applyTrustFrame(
    dir,
    {
      header: { msg_type: "0003" },
      body: {
        event_type: "DEPARTURE",
        train_id: "482N57MZ30",
        toc_id: "48",
        loc_stanox: "23547",
        actual_timestamp: "1790802300000",
      },
    },
    ymd,
  );
  const day = openDayDb(dir, ymd);
  const me = day.prepare(`SELECT atd, actual_source FROM calls WHERE rid='me1' AND tiploc='BRKNHDN'`).get();
  assert.equal(me.actual_source, "trust");
  assert.ok(me.atd);
  assert.ok(day.prepare(`SELECT json FROM trust_events LIMIT 1`).get()?.json);
  day.close();
});

test("CIF merge does not flip a Darwin public stop to a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "cif-"));
  const db = openDayDb(dir, "2026-10-01");
  upsertService(db, {
    rid: "202610017115813",
    uid: "7115813",
    train_id: "1P27",
    rs_id: null,
    toc: "TP",
    operator_name: "TP",
    origin_crs: "LDS",
    origin_name: "Leeds",
    destination_crs: "MCV",
    destination_name: "Manchester Victoria",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "1P27",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "202610017115813",
    tiploc: "DWBY",
    crs: "DEW",
    seq: 1,
    is_passing: 0,
    cancelled: 0,
    platform: null,
    length_cars: null,
    formation: null,
    sta: "16:26",
    std: "16:27",
    wta: "16:26",
    wtd: "16:27",
    wtp: null,
    ata: null,
    atd: null,
    atp: null,
    eta: null,
    etd: null,
    etp: null,
    delay_minutes: null,
    status: null,
    live_kind: "scheduled",
    actual_source: null,
    updated_at: 1,
  });
  upsertCall(
    db,
    {
      rid: "202610017115813",
      tiploc: "DWBY",
      crs: "DEW",
      seq: 9,
      is_passing: 1,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: "16:27",
      ata: null,
      atd: null,
      atp: null,
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: null,
      status: null,
      live_kind: "scheduled",
      actual_source: null,
      updated_at: 2,
    },
    { cifMerge: true },
  );
  upsertCall(
    db,
    {
      rid: "202610017115813",
      tiploc: "MIRFD",
      crs: null,
      seq: 2,
      is_passing: 1,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: "16:31",
      ata: null,
      atd: null,
      atp: null,
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: null,
      status: null,
      live_kind: "scheduled",
      actual_source: null,
      updated_at: 2,
    },
    { cifMerge: true },
  );
  const dew = db.prepare(`SELECT is_passing, sta FROM calls WHERE tiploc='DWBY'`).get();
  assert.equal(dew.is_passing, 0);
  assert.equal(dew.sta, "16:26");
  const pass = db.prepare(`SELECT is_passing, wtp FROM calls WHERE tiploc='MIRFD'`).get();
  assert.equal(pass.is_passing, 1);
  assert.equal(pass.wtp, "16:31");
  db.close();
});

test("?at= hides later actuals", () => {
  assert.equal(clockAfter("10:15", "16:27"), true);
  assert.equal(clockAfter("16:27", "16:27"), false);
  assert.equal(clockAfter("11:00", "23:01"), true);
  assert.equal(clockAfter("23:00", "11:00"), false);
  const masked = maskCallAsOf({ ata: "16:35", atd: "16:36", atp: null, wtp: "16:31" }, "10:15");
  assert.equal(masked.ata, null);
  assert.equal(masked.atd, null);
  const evening = maskCallAsOf({ etd: "23:01", atd: "23:01", live_kind: "actual" }, "11:00");
  assert.equal(evening.atd, null);
  assert.equal(evening.etd, "23:01");
  const trust = maskTrustOverlay({ atd: "16:36", actual_source: "trust", live_kind: "actual" });
  assert.equal(trust.atd, null);
  assert.equal(trust.actual_source, null);
});

test("location at_station when arrived and not departed", () => {
  const loc = computeServiceLocation(
    [
      { tiploc: "LDS", crs: "LDS", seq: 0, sta: "16:13", std: "16:16", ata: "16:14", atd: "16:17", is_passing: 0 },
      { tiploc: "DWBY", crs: "DEW", seq: 1, sta: "16:26", std: "16:27", ata: "16:35", atd: null, is_passing: 0 },
      { tiploc: "MCV", crs: "MCV", seq: 2, sta: "17:23", std: null, ata: null, atd: null, is_passing: 0 },
    ],
    { stationName: (crs) => ({ DEW: "Dewsbury", LDS: "Leeds", MCV: "Manchester Victoria" }[crs]) },
  );
  assert.equal(loc.phase, "at_station");
  assert.match(loc.label, /Dewsbury/);
});

