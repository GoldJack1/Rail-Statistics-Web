import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveKind, openDayDb, operatingDayYmd, upsertCall, upsertService } from "./db.js";
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
