import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptUidOntoRid, liveKind, openDayDb, operatingDayYmd, pruneCifUidStubRids, pruneFutureDayRids, upsertCall, upsertService } from "./db.js";
import { applyParsed, parseDarwinPayload, parseDarwinPportXml } from "./darwin-xml.js";

test("operating day rolls at 02:00 UK conceptually (returns yyyy-mm-dd)", () => {
  assert.match(operatingDayYmd(new Date("2026-09-30T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
});

test("liveKind prefers actual then working then scheduled", () => {
  assert.equal(liveKind({ ata: "10:01" }), "actual");
  assert.equal(liveKind({ eta: "10:02" }), "working");
  assert.equal(liveKind({}), "scheduled");
});

test("upsert is change-friendly and keeps Darwin pass actuals", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-09-30");
  upsertService(db, {
    rid: "r1",
    uid: "u1",
    train_id: "1A01",
    rs_id: null,
    toc: "GW",
    operator_name: "GWR",
    origin_crs: "PAD",
    origin_name: "Paddington",
    destination_crs: "BRI",
    destination_name: "Bristol",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "1A01",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "r1",
    tiploc: "RDNGSTN",
    crs: "RDG",
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
    wtp: "10:10",
    ata: null,
    atd: null,
    atp: "10:11",
    eta: null,
    etd: null,
    etp: null,
    delay_minutes: null,
    status: null,
    live_kind: "actual",
    actual_source: "darwin",
    updated_at: 1,
  });
  const row = db.prepare(`SELECT atp, is_passing, actual_source FROM calls WHERE rid='r1'`).get();
  assert.equal(row.atp, "10:11");
  assert.equal(row.is_passing, 1);
  assert.equal(row.actual_source, "darwin");
  db.close();
});

test("fillOnly overlay upgrades actual_source when filling pass actuals", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-fill-"));
  const db = openDayDb(dir, "2026-09-30");
  upsertCall(db, {
    rid: "r2",
    tiploc: "HOLBJCN",
    crs: null,
    seq: 1,
    is_passing: 1,
    cancelled: 0,
    platform: null,
    length_cars: null,
    formation: null,
    sta: null,
    std: null,
    wta: null,
    wtd: null,
    wtp: "15:46",
    ata: null,
    atd: null,
    atp: null,
    eta: null,
    etd: null,
    etp: null,
    delay_minutes: null,
    status: null,
    live_kind: "scheduled",
    actual_source: "orm",
    updated_at: 1,
  });
  upsertCall(
    db,
    {
      rid: "r2",
      tiploc: "HOLBJCN",
      crs: null,
      seq: 1,
      is_passing: 1,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: "15:46",
      ata: null,
      atd: null,
      atp: "15:47",
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: null,
      status: "TD",
      live_kind: "actual",
      actual_source: "td",
      updated_at: 2,
    },
    { overlay: true, fillOnly: true },
  );
  const row = db.prepare(`SELECT atp, actual_source FROM calls WHERE rid='r2'`).get();
  assert.equal(row.atp, "15:47");
  assert.equal(row.actual_source, "td");
  db.close();
});

test("TS overlay does not rewrite TOC, origin, pass flags, or extra stops", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-09-30");
  const call = (over) => ({
    rid: "ov1",
    cancelled: 0,
    platform: null,
    length_cars: null,
    formation: null,
    sta: null,
    std: null,
    wta: null,
    wtd: null,
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
    ...over,
  });
  applyParsed(db, {
    fullJourney: true,
    service: {
      rid: "ov1",
      uid: "u1",
      train_id: "1A01",
      rs_id: null,
      toc: "GW",
      operator_name: "GW",
      origin_crs: "PAD",
      origin_name: "Paddington",
      destination_crs: "OXF",
      destination_name: "Oxford",
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: "XX",
      headcode: "1A01",
      updated_at: 1,
    },
    calls: [
      call({ tiploc: "PADTON", crs: "PAD", seq: 0, is_passing: 0, std: "10:00" }),
      call({ tiploc: "RDNGSTN", crs: "RDG", seq: 1, is_passing: 1, wtp: "10:20" }),
      call({ tiploc: "OXFD", crs: "OXF", seq: 2, is_passing: 0, sta: "10:40" }),
    ],
  });
  applyParsed(db, {
    fullJourney: false,
    service: {
      rid: "ov1",
      uid: "u1",
      train_id: "1A01",
      rs_id: null,
      toc: "NT",
      operator_name: "NT",
      origin_crs: "RDG",
      origin_name: "Reading",
      destination_crs: "RDG",
      destination_name: "Reading",
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: null,
      headcode: "1A01",
      updated_at: 2,
    },
    calls: [
      call({ tiploc: "RDNGSTN", crs: "RDG", seq: 99, is_passing: 0, std: "10:20", etd: "10:22", updated_at: 2 }),
      call({ tiploc: "JUNKXX", crs: "XXX", seq: 100, is_passing: 0, std: "10:30", updated_at: 2 }),
    ],
  });
  const svc = db.prepare(`SELECT toc, origin_crs, destination_crs FROM services WHERE rid='ov1'`).get();
  assert.equal(svc.toc, "GW");
  assert.equal(svc.origin_crs, "PAD");
  assert.equal(svc.destination_crs, "OXF");
  const rdg = db.prepare(`SELECT is_passing, etd FROM calls WHERE rid='ov1' AND tiploc='RDNGSTN'`).get();
  assert.equal(rdg.is_passing, 1);
  assert.equal(rdg.etd, "10:22");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE rid='ov1'`).get().n, 3);
  db.close();
});

test("unwraps RDM text/bytes envelope", () => {
  const xml = `<?xml version="1.0"?><Pport><TS rid="RDMTEXT1" uid="X"><DT tpl="PADTON" crs="PAD" ptd="0800"></DT></TS></Pport>`;
  const parsed = parseDarwinPayload(JSON.stringify({ destination: { name: "x" }, text: xml, bytes: null }));
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "RDMTEXT1");
});

test("unwraps RDM destination envelope around TS JSON", () => {
  const inner = {
    Pport: { uR: { TS: { rid: "202609309999997", Location: [{ tpl: "PADTON", crs: "PAD", ptd: "0900" }] } } },
  };
  const parsed = parseDarwinPayload(
    JSON.stringify({ destination: { name: "Consumer.rdmportal.VirtualTopic.PushPort-v18" }, body: JSON.stringify(inner) }),
  );
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "202609309999997");
});

test("parses namespaced JSON TS with @rid", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      Pport: {
        uR: {
          "ns2:TS": {
            "@rid": "20260930NSRID1",
            "@toc": "GW",
            "ns2:Location": [{ "@tpl": "PADTON", "@crs": "PAD", "@ptd": "1015", "@atd": "1016" }],
          },
        },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "20260930NSRID1");
  assert.equal(parsed.calls[0].crs, "PAD");
  assert.equal(parsed.calls[0].atd, "10:16");
});

test("parses RDM envelope when text is a Pport object", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      destination: { name: "Consumer.rdmportal.VirtualTopic.PushPort-v18" },
      text: {
        Pport: { uR: { TS: { rid: "TEXTOBJ1", Location: [{ tpl: "PADTON", crs: "PAD", ptd: "1100" }] } } },
      },
      bytes: "",
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "TEXTOBJ1");
});

test("parse Darwin JSON TS extracts rid", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      Pport: {
        uR: {
          TS: {
            rid: "202609309999998",
            uid: "C99999",
            toc: "GW",
            Location: [{ tpl: "PADTON", crs: "PAD", ptd: "1000", atd: "1001" }],
          },
        },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "202609309999998");
  assert.equal(parsed.calls[0].crs, "PAD");
  assert.equal(parsed.calls[0].atd, "10:01");
});

test("parse Darwin TS XML extracts rid and pass flag", () => {
  const xml = `<?xml version="1.0"?><Pport><TS rid="202609309999999" uid="C12345" toc="GW" trainId="1A01">
    <PP tpl="RDNGSTN" crs="RDG" wtp="1010" atp="1011"></PP>
    <DT tpl="BRSTLTM" crs="BRI" pta="1200" ptd="1201" ata="1202"></DT>
  </TS></Pport>`;
  const parsed = parseDarwinPportXml(xml);
  assert.ok(parsed);
  assert.equal(parsed.service.rid, "202609309999999");
  assert.equal(parsed.calls[0].is_passing, 1);
  assert.equal(parsed.calls[0].atp, "10:11");
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-09-30");
  applyParsed(db, parsed);
  const n = db.prepare(`SELECT COUNT(*) AS c FROM calls`).get().c;
  assert.equal(n, 2);
  db.close();
});

test("platform objects do not stringify to [object Object]", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      Pport: {
        uR: {
          TS: {
            rid: "PLATOBJ1",
            toc: "NT",
            Location: [
              { tpl: "DWBY", crs: "DEW", ptd: "1726", plat: { platsrc: "a", "#text": "2" } },
              { tpl: "BRHOUSE", crs: "BGH", pta: "1735", plat: { "@platsrc": "a", "#text": "1" } },
            ],
          },
        },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.calls[0].platform, "2");
  assert.equal(parsed.calls[1].platform, "1");
});

test("does not duplicate Location plus typed PP/IP buckets", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      Pport: {
        uR: {
          TS: {
            rid: "DUPLOC1",
            Location: [
              { tpl: "WHRDJN", wtp: "1716" },
              { tpl: "DWBY", crs: "DEW", pta: "1725", ptd: "1726" },
            ],
            PP: [{ tpl: "WHRDJN", wtp: "1716" }],
            IP: [{ tpl: "DWBY", crs: "DEW", pta: "1725", ptd: "1726" }],
          },
        },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.calls.length, 2);
  assert.equal(parsed.calls.find((c) => c.tiploc === "WHRDJN").is_passing, 1);
  assert.equal(parsed.calls.find((c) => c.tiploc === "DWBY").is_passing, 0);
  assert.equal(parsed.calls.find((c) => c.tiploc === "WHRDJN").sta, null);
});

test("RDM bytes JSON schedule is parsed and tiny ts heartbeats are not", () => {
  const inner = {
    ts: "2026-09-30T17:43:14.3310049+01:00",
    version: "18.0",
    uR: {
      schedule: {
        rid: "20260930S9",
        uid: "G15837",
        toc: "NT",
        trainId: "2T99",
        OR: { tpl: "LDS", crs: "LDS", ptd: "1700" },
        DT: { tpl: "HLFX", crs: "HFX", pta: "1748" },
      },
    },
  };
  const parsed = parseDarwinPayload(JSON.stringify({ destination: { name: "x" }, text: {}, bytes: JSON.stringify(inner) }));
  assert.ok(parsed);
  assert.equal(parsed.service.toc, "NT");
  assert.equal(parsed.service.destination_crs, "HFX");
  const tiny = parseDarwinPayload(
    JSON.stringify({
      destination: { name: "x" },
      text: {},
      bytes: JSON.stringify({ ts: "2026-09-30T17:43:14.3310049+01:00", version: "18.0", uR: { updateOrigin: "CIS" } }),
    }),
  );
  assert.equal(tiny, null);
});

test("CIF uid is adopted onto an existing Darwin rid", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-09-30");
  upsertService(db, {
    rid: "cif-G15837",
    uid: "G15837",
    train_id: "2T00",
    rs_id: null,
    toc: "NT",
    operator_name: "NT",
    origin_crs: "LDS",
    origin_name: "Leeds",
    destination_crs: "HFX",
    destination_name: "Halifax",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "OO",
    headcode: "2T00",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "cif-G15837",
    tiploc: "HLFX",
    crs: "HFX",
    seq: 9,
    is_passing: 0,
    cancelled: 0,
    platform: null,
    length_cars: null,
    formation: null,
    sta: "17:48",
    std: null,
    wta: "17:48",
    wtd: null,
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
  applyParsed(db, {
    service: {
      rid: "202609307115837",
      uid: "G15837",
      train_id: "2T00",
      rs_id: null,
      toc: "NT",
      operator_name: "NT",
      origin_crs: "DEW",
      origin_name: "Dewsbury",
      destination_crs: "BGH",
      destination_name: "Brighouse",
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: "OO",
      headcode: "2T00",
      updated_at: 2,
    },
    fullJourney: true,
    calls: [
      {
        rid: "202609307115837",
        tiploc: "DWBY",
        crs: "DEW",
        seq: 0,
        is_passing: 0,
        cancelled: 0,
        platform: "2",
        length_cars: null,
        formation: null,
        sta: "17:25",
        std: "17:26",
        wta: "17:25",
        wtd: "17:26",
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
        updated_at: 2,
      },
    ],
  });
  const hfx = db.prepare(`SELECT crs FROM calls WHERE rid = '202609307115837' AND tiploc = 'HLFX'`).get();
  assert.equal(hfx?.crs, "HFX");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM services WHERE uid = 'G15837'`).get().n, 1);
  db.close();
});

test("Darwin overlay matches a public stop by CRS when TIPLOC differs", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-crs-"));
  const db = openDayDb(dir, "2026-09-30");
  upsertService(db, {
    rid: "202610016724937",
    uid: "G24937",
    train_id: "1P90",
    rs_id: null,
    toc: "TP",
    operator_name: "TP",
    origin_crs: "LDS",
    origin_name: "Leeds",
    destination_crs: "MAN",
    destination_name: "Manchester",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "1P90",
    updated_at: 1,
  });
  upsertCall(db, {
    rid: "202610016724937",
    tiploc: "LEEDS",
    crs: "LDS",
    seq: 0,
    is_passing: 0,
    cancelled: 0,
    platform: "16",
    length_cars: null,
    formation: null,
    sta: null,
    std: "23:20",
    wta: null,
    wtd: "23:20",
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
      rid: "202610016724937",
      tiploc: "LDST",
      crs: "LDS",
      seq: 0,
      is_passing: 0,
      cancelled: 0,
      platform: "16",
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: null,
      ata: null,
      atd: null,
      atp: null,
      eta: null,
      etd: "23:24",
      etp: null,
      delay_minutes: null,
      status: null,
      live_kind: "working",
      actual_source: null,
      updated_at: 2,
    },
    { overlay: true },
  );
  const row = db.prepare(`SELECT etd, live_kind, tiploc FROM calls WHERE rid = '202610016724937'`).get();
  assert.equal(row.tiploc, "LEEDS");
  assert.equal(row.etd, "23:24");
  assert.equal(row.live_kind, "working");
  db.close();
});

test("Darwin JSON @et forecasts parse onto calls", () => {
  const parsed = parseDarwinPayload(
    JSON.stringify({
      TS: {
        rid: "202610016724937",
        uid: "G24937",
        toc: "TP",
        Location: {
          tpl: "LEEDS",
          crs: "LDS",
          ptd: "2320",
          dep: { "@et": "2324" },
        },
      },
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.calls[0].etd, "23:24");
});

test("Darwin overlay still adopts a CIF uid stub onto the 15-digit RID", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-03");
  upsertService(db, {
    rid: "20261003L89273",
    uid: "L89273",
    train_id: "2I21",
    rs_id: null,
    toc: null,
    operator_name: null,
    origin_crs: null,
    origin_name: "Wigan Wallgate",
    destination_crs: null,
    destination_name: "Leeds West Junction",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "OO",
    headcode: "2I21",
    updated_at: 1,
  });
  applyParsed(db, {
    fullJourney: false,
    service: {
      rid: "202610037689273",
      uid: "L89273",
      train_id: "2I21",
      rs_id: null,
      toc: "NT",
      operator_name: "NT",
      origin_crs: "WGW",
      origin_name: "Wigan Wallgate",
      destination_crs: "LDS",
      destination_name: "Leeds",
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: "OO",
      headcode: "2I21",
      updated_at: 2,
    },
    calls: [],
  });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM services WHERE uid='L89273'`).get().n, 1);
  assert.equal(db.prepare(`SELECT rid, toc FROM services WHERE uid='L89273'`).get().rid, "202610037689273");
  db.close();
});

test("pruneFutureDayRids drops next-day RIDs from today's file", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-03");
  upsertService(db, {
    rid: "202610037115982",
    uid: "G15982",
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertService(db, {
    rid: "202610046724632",
    uid: "C24632",
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertCall(db, { rid: "202610037115982", tiploc: "MNCRVIC", seq: 0, std: "17:00" });
  upsertCall(db, { rid: "202610046724632", tiploc: "MNCRIAP", seq: 0, std: "16:44" });
  const pruned = pruneFutureDayRids(db, "2026-10-03");
  assert.equal(pruned.services, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM services`).get().n, 1);
  assert.equal(db.prepare(`SELECT rid FROM services`).get().rid, "202610037115982");
  db.close();
});

test("adoptUidOntoRid copies CIF toc/headcode onto the Darwin stub", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-05");
  upsertService(db, {
    rid: "202610056704488",
    uid: "C04488",
    toc: null,
    headcode: null,
    train_id: null,
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertService(db, {
    rid: "20261005C04488",
    uid: "C04488",
    toc: "CS",
    headcode: "1A25",
    train_id: "1A25",
    category: "XZ",
    origin_name: "Edinburgh",
    destination_name: "Aberdeen",
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertCall(db, { rid: "20261005C04488", tiploc: "EDINBUR", crs: "EDB", seq: 0, std: "04:28" });
  upsertCall(db, { rid: "20261005C04488", tiploc: "ABRDEEN", crs: "ABD", seq: 1, sta: "07:50" });
  adoptUidOntoRid(db, "C04488", "202610056704488");
  const svc = db.prepare(`SELECT toc, headcode, train_id, destination_name FROM services WHERE rid = ?`).get("202610056704488");
  assert.equal(svc.toc, "CS");
  assert.equal(svc.headcode, "1A25");
  assert.equal(svc.destination_name, "Aberdeen");
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM services WHERE rid = '20261005C04488'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE rid = '202610056704488'`).get().n, 2);
  db.close();
});

test("pruneCifUidStubRids drops YYYYMMDD+UID stubs when Darwin RIDs exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "rail-core-"));
  const db = openDayDb(dir, "2026-10-03");
  upsertService(db, {
    rid: "202610037689498",
    uid: "L89498",
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertService(db, {
    rid: "20261003L89498",
    uid: "L89498",
    service_type: "passenger",
    cancelled: 0,
    is_charter: 0,
    updated_at: 1,
  });
  upsertCall(db, { rid: "20261003L89498", tiploc: "LEEDS", seq: 0, std: "20:47" });
  const pruned = pruneCifUidStubRids(db);
  assert.equal(pruned.services, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM services`).get().n, 1);
  assert.equal(db.prepare(`SELECT rid FROM services`).get().rid, "202610037689498");
  db.close();
});
