import { test } from "node:test";
import assert from "node:assert/strict";
import { dropUnreportedOrmPasses, overlayTdOnCalls } from "./query-enrich.js";
import { openDayDb } from "./db.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("dropUnreportedOrmPasses keeps reported ORM and CIF spine", () => {
  const calls = [
    { tiploc: "LEEDS", actual_source: null, atd: "10:01" },
    { tiploc: "GHOST", actual_source: "orm", wtp: "10:02" },
    { tiploc: "HIT", actual_source: "orm", atp: "10:03" },
  ];
  const out = dropUnreportedOrmPasses(calls);
  assert.deepEqual(
    out.map((c) => c.tiploc),
    ["LEEDS", "HIT"],
  );
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
