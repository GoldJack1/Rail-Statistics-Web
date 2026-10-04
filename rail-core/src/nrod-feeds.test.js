import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDayDb, upsertService } from "./db.js";
import { scheduleJsonLocation, workingFromScheduleJson } from "./cif-overlay.js";
import { applyTdFrame, tdForHeadcode, tdMessages } from "./td-apply.js";
import { vstpMessages } from "./vstp-apply.js";

test("SCHEDULE JSON location maps pass/public times", () => {
  const loc = scheduleJsonLocation({
    tiploc_code: "HOLBJCN",
    pass: "1546",
    public_arrival: null,
    public_departure: null,
  });
  assert.equal(loc.tiploc, "HOLBJCN");
  assert.equal(loc.wtp, "15:46");
  assert.equal(loc.passing, true);
});

test("VSTP schedule unwraps into a working", () => {
  const working = workingFromScheduleJson({
    CIF_train_uid: "G16021",
    CIF_stp_indicator: "O",
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
  });
  assert.equal(working.uid, "G16021");
  assert.equal(working.locs.length, 3);
  assert.equal(working.locs[1].tiploc, "HOLBJCN");
});

test("vstpMessages accepts VSTPCIFMsgV1 wrapper", () => {
  const msgs = vstpMessages(JSON.stringify({ VSTPCIFMsgV1: { schedule: { CIF_train_uid: "G16021" } } }));
  assert.equal(msgs.length, 1);
});

test("TD CA message updates last berth for headcode", () => {
  const dir = mkdtempSync(join(tmpdir(), "td-"));
  const db = openDayDb(dir, "2026-10-04");
  upsertService(db, {
    rid: "202610047116021",
    uid: "G16021",
    train_id: "1P76",
    rs_id: null,
    toc: "TP",
    operator_name: "TP",
    origin_crs: "RCC",
    origin_name: "Redcar Central",
    destination_crs: "MIA",
    destination_name: "Manchester Airport",
    via: null,
    service_type: "passenger",
    cancelled: 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: "XX",
    headcode: "1P76",
    updated_at: 1,
  });
  db.close();
  const frames = tdMessages({
    CA_MSG: { msg_type: "CA", area_id: "Y2", from: "A123", to: "B456", descr: "1P76", time: "153045" },
  });
  assert.equal(frames.length, 1);
  assert.equal(applyTdFrame(dir, frames[0], "2026-10-04"), true);
  const day = openDayDb(dir, "2026-10-04");
  const td = tdForHeadcode(day, "1P76");
  assert.equal(td.berth, "B456");
  assert.equal(td.areaId, "Y2");
  assert.equal(td.rid, "202610047116021");
  day.close();
});
