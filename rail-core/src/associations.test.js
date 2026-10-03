import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { openCatalog, openDayDb } from "./db.js";
import {
  collapseOvernightAssociates,
  combinedDestinationName,
  extractDarwinAssociationsXml,
  inferAssociationsFromConsist,
  inferScheduleDivides,
  parseCifAa,
  filterDisplayAssociations,
} from "./associations.js";
import { unitIdsAtBoardCall } from "./ptac-apply.js";

test("Darwin Association XML parses a divide", () => {
  const xml = `<Association category="VV" tiploc="GLOSTER">
    <main rid="R1" uid="G01161" trainId="1V64"/>
    <assoc rid="R2" uid="G66477" trainId="1C64"/>
  </Association>`;
  const rows = extractDarwinAssociationsXml(xml);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "VV");
  assert.equal(rows[0].main_rid, "R1");
  assert.equal(rows[0].assoc_rid, "R2");
  assert.equal(rows[0].tiploc, "GLOSTER");
});

test("CIF AA record maps UIDs", () => {
  const aa = Array.from({ length: 80 }, () => " ");
  const put = (from1, text) => {
    for (let i = 0; i < text.length; i++) aa[from1 - 1 + i] = text[i];
  };
  put(1, "AA");
  put(3, "G01161");
  put(9, "G66477");
  put(15, "260518");
  put(22, "261211");
  put(29, "1111111");
  put(36, "VV");
  put(39, "GLOSTER");
  const parsed = parseCifAa(aa.join(""), "2026-10-02", (uid) => `RID${uid}`);
  assert.equal(parsed?.category, "VV");
  assert.equal(parsed?.main_rid, "RIDG01161");
  assert.equal(parsed?.assoc_rid, "RIDG66477");
  assert.equal(parsed?.tiploc, "GLOSTER");
});

test("combined destination names a divide", () => {
  assert.equal(
    combinedDestinationName("Cardiff Central", [
      { category: "VV", role: "main", isCancelled: false, tiploc: "GLOSTER", otherDestinationName: "Plymouth" },
    ]),
    "Cardiff Central & Plymouth",
  );
  assert.equal(
    combinedDestinationName("Cardiff Central", [
      { category: "VV", role: "main", isCancelled: false, tiploc: "GLOSTER", otherDestinationName: "Plymouth" },
      { category: "VV", role: "main", isCancelled: false, tiploc: "BHAMNWS", otherDestinationName: "Nottingham" },
      { category: "VV", role: "main", isCancelled: false, tiploc: "BHAMNWS", otherDestinationName: "Cambridge" },
      { category: "VV", role: "main", isCancelled: false, tiploc: "BHAMNWS", otherDestinationName: "Leicester" },
    ]),
    "Cardiff Central & Plymouth",
  );
});

test("PTAC inference links a detached unit to the onward UID", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-"));
  const db = openDayDb(dir, "2026-10-02");
  const catalog = openCatalog(dir);
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'XC', 'XC', null, ?, null, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  ).run("R1", "G01161", "1V64", "Edinburgh", "Cardiff Central", "1V64");
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'XC', 'XC', null, ?, null, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  ).run("R2", "G66477", "1C64", "Gloucester", "Plymouth", "1C64");
  db.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind) VALUES
    ('R1','GLOSTER',null,1,0,0,1,'scheduled'),
    ('R2','GLOSTER',null,0,0,0,1,'scheduled'),
    ('R2','PLYMTH',null,1,0,0,1,'scheduled')`).run();

  const consist = {
    allocations: [
      {
        trainOrigin: { tiploc: "EDINBUR" },
        trainDest: { tiploc: "CRDFCEN" },
        allocationOrigin: { tiploc: "EDINBUR" },
        allocationOriginDateTime: "2026-10-02T13:05:00",
        allocationDestination: { tiploc: "GLOSTER" },
        allocationDestinationDateTime: "2026-10-02T18:59:30",
        resourceGroups: [{ unitId: "220008" }, { unitId: "220033" }],
      },
      {
        trainOrigin: { tiploc: "EDINBUR" },
        trainDest: { tiploc: "CRDFCEN" },
        allocationOrigin: { tiploc: "GLOSTER" },
        allocationOriginDateTime: "2026-10-02T19:12:00",
        allocationDestination: { tiploc: "CRDFCEN" },
        allocationDestinationDateTime: "2026-10-02T20:06:00",
        resourceGroups: [{ unitId: "220033" }],
      },
    ],
  };
  catalog.prepare(
    `INSERT INTO consists (uid, ssd, origin_hhmm, headcode, origin_tpl, unit_ids, json, updated_at)
     VALUES (?, '2026-10-02', '', '1C64', 'GLOSTER', ?, ?, 1)`,
  ).run(
    "G66477",
    JSON.stringify(["220008"]),
    JSON.stringify({
      allocations: [
        {
          trainOrigin: { tiploc: "GLOSTER" },
          trainDest: { tiploc: "PLYMTH" },
          allocationOrigin: { tiploc: "GLOSTER" },
          allocationOriginDateTime: "2026-10-02T19:07:00",
          allocationDestination: { tiploc: "PLYMTH" },
          allocationDestinationDateTime: "2026-10-02T21:51:00",
          resourceGroups: [{ unitId: "220008" }],
        },
      ],
    }),
  );

  const inferred = inferAssociationsFromConsist({
    db,
    catalog,
    ymd: "2026-10-02",
    svc: { rid: "R1", uid: "G01161" },
    consist,
    stationName: (_c, tpl) => (tpl === "PLYMTH" ? "Plymouth" : tpl),
  });
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].otherRid, "R2");
  assert.equal(inferred[0].otherTrainId, "1C64");
  assert.equal(inferred[0].otherDestinationName, "Plymouth");
  db.close();
  catalog.close();
});

test("PTAC inference does not treat an en-route unit swap as a divide", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-swap-"));
  const db = openDayDb(dir, "2026-10-03");
  const catalog = openCatalog(dir);
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'TP', 'TP', null, ?, null, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  ).run("R1", "G16125", "1P40", "Scarborough", "Manchester Airport", "1P40");
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'TP', 'TP', null, ?, null, ?, null, 'passenger', 0, null, null, 0, 'OO', ?, 1)`,
  ).run("R2", "C24765", "2U86", "York", "Wakefield Kirkgate", "2U86");
  db.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind) VALUES
    ('R2','YORK',null,0,0,0,1,'scheduled'),
    ('R2','WKFLDKG',null,1,0,0,1,'scheduled')`).run();

  const consist = {
    allocations: [
      {
        trainOrigin: { tiploc: "SCARBRO" },
        trainDest: { tiploc: "MNCRIAP" },
        allocationOrigin: { tiploc: "SCARBRO" },
        allocationOriginDateTime: "2026-10-03T19:53:00",
        allocationDestination: { tiploc: "YORK" },
        allocationDestinationDateTime: "2026-10-03T20:46:00",
        resourceGroups: [{ unitId: "185103" }],
      },
      {
        trainOrigin: { tiploc: "SCARBRO" },
        trainDest: { tiploc: "MNCRIAP" },
        allocationOrigin: { tiploc: "YORK" },
        allocationOriginDateTime: "2026-10-03T20:57:00",
        allocationDestination: { tiploc: "MNCRIAP" },
        allocationDestinationDateTime: "2026-10-03T23:14:00",
        reversed: true,
        resourceGroups: [{ unitId: "185118" }],
      },
    ],
  };
  catalog.prepare(
    `INSERT INTO consists (uid, ssd, origin_hhmm, headcode, origin_tpl, unit_ids, json, updated_at)
     VALUES (?, '2026-10-03', '', '2U86', 'YORK', ?, ?, 1)`,
  ).run(
    "C24765",
    JSON.stringify(["185103"]),
    JSON.stringify({
      allocations: [
        {
          trainOrigin: { tiploc: "YORK" },
          trainDest: { tiploc: "WKFLDKG" },
          allocationOrigin: { tiploc: "YORK" },
          allocationOriginDateTime: "2026-10-03T21:06:00",
          allocationDestination: { tiploc: "WKFLDKG" },
          allocationDestinationDateTime: "2026-10-03T21:50:00",
          resourceGroups: [{ unitId: "185103" }],
        },
      ],
    }),
  );

  const inferred = inferAssociationsFromConsist({
    db,
    catalog,
    ymd: "2026-10-03",
    svc: { rid: "R1", uid: "G16125" },
    consist,
    stationName: (_c, tpl) => tpl,
  });
  assert.equal(inferred.length, 0);
  db.close();
  catalog.close();
});

test("unitIdsAtBoardCall drops the detached unit after the divide", () => {
  const row = {
    json: JSON.stringify({
      allocations: [
        {
          allocationOrigin: { tiploc: "EDINBUR" },
          allocationDestination: { tiploc: "GLOSTER" },
          allocationOriginDateTime: "2026-10-02T13:05:00",
          allocationDestinationDateTime: "2026-10-02T18:59:30",
          resourceGroups: [{ unitId: "220008" }, { unitId: "220033" }],
        },
        {
          allocationOrigin: { tiploc: "GLOSTER" },
          allocationDestination: { tiploc: "CRDFCEN" },
          allocationOriginDateTime: "2026-10-02T19:12:00",
          allocationDestinationDateTime: "2026-10-02T20:06:00",
          resourceGroups: [{ unitId: "220033" }],
        },
      ],
    }),
  };
  assert.deepEqual(
    unitIdsAtBoardCall(row, { tiploc: "GLOSTER", hhmm: "19:12", movement: "departure" }).sort(),
    ["220033"],
  );
  assert.deepEqual(
    unitIdsAtBoardCall(row, { tiploc: "YORK", hhmm: "15:00", movement: "departure" }).sort(),
    ["220008", "220033"],
  );
});

test("schedule inference finds sleeper portions leaving Edinburgh", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-sched-"));
  const db = openDayDb(dir, "2026-10-02");
  const insertSvc = db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'CS', 'Caledonian Sleeper', ?, ?, ?, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  );
  insertSvc.run("R1S", "C04570", "1S25", "EUS", "London Euston", "INV", "Inverness", "1S25");
  insertSvc.run("R1A", "C04542", "1A25", "EDB", "Edinburgh", "ABD", "Aberdeen", "1A25");
  insertSvc.run("R1Y", "C04576", "1Y11", "EDB", "Edinburgh", "FTW", "Fort William", "1Y11");
  db.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind, sta, std) VALUES
    ('R1S','EUSTON','EUS',0,0,0,1,'scheduled',null,'21:15'),
    ('R1S','EDINBUR','EDB',80,0,0,1,'scheduled','04:40','04:52'),
    ('R1S','IVRNESS','INV',119,0,0,1,'scheduled','08:45',null),
    ('R1A','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:28'),
    ('R1A','ABRDEEN','ABD',42,0,0,1,'scheduled','07:50',null),
    ('R1Y','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:50'),
    ('R1Y','FRTWLM','FTW',41,0,0,1,'scheduled','10:00',null)`).run();

  const svc = db.prepare(`SELECT * FROM services WHERE rid = 'R1S'`).get();
  const found = inferScheduleDivides({
    db,
    svc,
    stationName: (_crs, tpl) =>
      ({ EDINBUR: "Edinburgh", ABRDEEN: "Aberdeen", FRTWLM: "Fort William" }[tpl] || tpl),
  });
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((a) => a.otherDestinationName).sort(),
    ["Aberdeen", "Fort William"],
  );
  assert.ok(found.every((a) => a.category === "VV" && a.tiploc === "EDINBUR" && a.role === "main"));
});

test("Edinburgh sleeper portions match after the railway day change", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-ovn-"));
  const db1 = openDayDb(dir, "2026-10-01");
  const db2 = openDayDb(dir, "2026-10-02");
  const insert = (db, rid, uid, head, oCrs, oName, dCrs, dName) => {
    db.prepare(
      `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
        destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
        is_charter, category, headcode, updated_at)
       VALUES (?, ?, ?, null, 'CS', 'Caledonian Sleeper', ?, ?, ?, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
    ).run(rid, uid, head, oCrs, oName, dCrs, dName, head);
  };
  insert(db1, "202610011S25", "C04568", "1S25", "EUS", "London Euston", "INV", "Inverness");
  insert(db2, "202610021A25", "C04542", "1A25", "EDB", "Edinburgh", "ABD", "Aberdeen");
  insert(db2, "202610021Y11", "C04576", "1Y11", "EDB", "Edinburgh", "FTW", "Fort William");
  insert(db2, "202610021S25", "C04570", "1S25", "EUS", "London Euston", "INV", "Inverness");
  insert(db2, "202610031A25", "C04544", "1A25", "EDB", "Edinburgh", "ABD", "Aberdeen");
  insert(db2, "202610031Y11", "C04578", "1Y11", "EDB", "Edinburgh", "FTW", "Fort William");
  db1.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind, sta, std) VALUES
    ('202610011S25','EUSTON','EUS',0,0,0,1,'scheduled',null,'21:15'),
    ('202610011S25','EDINBUR','EDB',80,0,0,1,'scheduled','04:40','04:52'),
    ('202610011S25','IVRNESS','INV',119,0,0,1,'scheduled','08:45',null)`).run();
  db2.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind, sta, std) VALUES
    ('202610021A25','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:28'),
    ('202610021A25','ABRDEEN','ABD',42,0,0,1,'scheduled','07:50',null),
    ('202610021Y11','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:50'),
    ('202610021Y11','FRTWLM','FTW',41,0,0,1,'scheduled','10:00',null),
    ('202610021S25','EUSTON','EUS',0,0,0,1,'scheduled',null,'21:15'),
    ('202610021S25','EDINBUR','EDB',80,0,0,1,'scheduled','04:40','04:52'),
    ('202610021S25','IVRNESS','INV',119,0,0,1,'scheduled','08:45',null),
    ('202610031A25','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:28'),
    ('202610031A25','ABRDEEN','ABD',42,0,0,1,'scheduled','07:50',null),
    ('202610031Y11','EDINBUR','EDB',0,0,0,1,'scheduled',null,'04:50'),
    ('202610031Y11','FRTWLM','FTW',41,0,0,1,'scheduled','10:00',null)`).run();

  const names = (_crs, tpl) =>
    ({ EDINBUR: "Edinburgh", ABRDEEN: "Aberdeen", FRTWLM: "Fort William", EUSTON: "London Euston", IVRNESS: "Inverness" }[tpl] || tpl);
  const databases = [
    { ymd: "2026-10-01", db: db1 },
    { ymd: "2026-10-02", db: db2 },
  ];
  const tonight = db2.prepare(`SELECT * FROM services WHERE rid = '202610021S25'`).get();
  const fromTonight = inferScheduleDivides({ db: db2, svc: tonight, stationName: names, ymd: "2026-10-02", databases });
  assert.deepEqual(fromTonight.map((a) => a.otherRid).sort(), ["202610031A25", "202610031Y11"]);

  const abd = db2.prepare(`SELECT * FROM services WHERE rid = '202610021A25'`).get();
  const fromAbd = inferScheduleDivides({ db: db2, svc: abd, stationName: names, ymd: "2026-10-02", databases });
  assert.equal(fromAbd.find((a) => a.role === "associated")?.otherRid, "202610011S25");
  assert.equal(fromAbd.find((a) => a.otherDestinationName === "Fort William")?.otherRid, "202610021Y11");
  assert.equal(fromAbd.some((a) => a.otherRid === "202610021S25"), false);
  db1.close();
  db2.close();
});

test("southbound sleeper joins Fort William and Aberdeen at Edinburgh", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-join-"));
  const db = openDayDb(dir, "2026-10-02");
  const insert = db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'CS', 'Caledonian Sleeper', ?, ?, ?, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  );
  insert.run("202610021M16", "C04564", "1M16", "INV", "Inverness", "EUS", "London Euston", "1M16");
  insert.run("202610021B01", "C04548", "1B01", "FTW", "Fort William", "EDB", "Edinburgh", "1B01");
  insert.run("202610021B16", "C04552", "1B16", "ABD", "Aberdeen", "EDB", "Edinburgh", "1B16");
  db.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind, sta, std) VALUES
    ('202610021M16','IVRNESS','INV',0,0,0,1,'scheduled',null,'20:45'),
    ('202610021M16','EDINBUR','EDB',80,0,0,1,'scheduled','00:55','01:24'),
    ('202610021M16','EUSTON','EUS',119,0,0,1,'scheduled','08:00',null),
    ('202610021B01','FRTWLM','FTW',0,0,0,1,'scheduled',null,'19:50'),
    ('202610021B01','EDINBUR','EDB',35,0,0,1,'scheduled','01:08',null),
    ('202610021B16','ABRDEEN','ABD',0,0,0,1,'scheduled',null,'21:43'),
    ('202610021B16','EDINBUR','EDB',33,0,0,1,'scheduled','01:12',null)`).run();
  const names = (_crs, tpl) =>
    ({ EDINBUR: "Edinburgh", FRTWLM: "Fort William", ABRDEEN: "Aberdeen", IVRNESS: "Inverness", EUSTON: "London Euston" }[tpl] || tpl);
  const main = db.prepare(`SELECT * FROM services WHERE rid = '202610021M16'`).get();
  const found = inferScheduleDivides({ db, svc: main, stationName: names, ymd: "2026-10-02" });
  assert.equal(found.filter((a) => a.category === "JJ").length, 2);
  assert.deepEqual(found.map((a) => a.otherOriginName).sort(), ["Aberdeen", "Fort William"]);
  const ftw = db.prepare(`SELECT * FROM services WHERE rid = '202610021B01'`).get();
  const fromFtw = inferScheduleDivides({ db, svc: ftw, stationName: names, ymd: "2026-10-02" });
  assert.equal(fromFtw.find((a) => a.role === "associated")?.otherRid, "202610021M16");
  assert.equal(fromFtw.find((a) => a.otherTrainId === "1B16")?.otherRid, "202610021B16");
  db.close();
});

test("schedule inference does not attach ordinary CrossCountry connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "assoc-xc-"));
  const db = openDayDb(dir, "2026-10-02");
  const insertSvc = db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (?, ?, ?, null, 'XC', 'CrossCountry', ?, ?, ?, ?, null, 'passenger', 0, null, null, 0, 'XX', ?, 1)`,
  );
  insertSvc.run("R1", "G01161", "1V64", "EDB", "Edinburgh", "CDF", "Cardiff Central", "1V64");
  insertSvc.run("R2", "G09999", "1D74", "DBY", "Derby", "NOT", "Nottingham", "1D74");
  db.prepare(`INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, updated_at, live_kind, sta, std) VALUES
    ('R1','EDINBUR','EDB',0,0,0,1,'scheduled',null,'13:05'),
    ('R1','DRBY','DBY',10,0,0,1,'scheduled','16:40','16:42'),
    ('R1','CRDFCEN','CDF',20,0,0,1,'scheduled','20:06',null),
    ('R2','DRBY','DBY',0,0,0,1,'scheduled',null,'16:50'),
    ('R2','NOTNGHM','NOT',5,0,0,1,'scheduled','17:20',null)`).run();
  const svc = db.prepare(`SELECT * FROM services WHERE rid = 'R1'`).get();
  assert.equal(inferScheduleDivides({ db, svc, stationName: () => "X" }).length, 0);
});

test("display associations drop ECS and freight headcodes", () => {
  const rows = filterDisplayAssociations([
    {
      category: "NP",
      role: "main",
      otherRid: "N63312",
      otherTrainId: "5P83",
      tiploc: "MIA",
      isCancelled: false,
      isDeleted: false,
    },
    {
      category: "VV",
      role: "main",
      otherRid: "R2",
      otherTrainId: "1C64",
      tiploc: "GLOSTER",
      otherDestinationName: "Plymouth",
      isCancelled: false,
      isDeleted: false,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].otherTrainId, "1C64");
});
