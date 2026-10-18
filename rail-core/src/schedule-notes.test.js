import { test } from "node:test";
import assert from "node:assert/strict";
import { allowanceText, annotateStops, daysRunLabel, pathedAsLabel, publicSchedule } from "./schedule-notes.js";

test("pathed as names the timing-load class group and a later change", () => {
  assert.equal(pathedAsLabel({ powerType: "DMU", timingLoad: "150", speed: "75" }), "Pathed as Class 150/153/155/156 DMU at 75mph");
  assert.equal(pathedAsLabel({ powerType: "EMU", timingLoad: "800", speed: "125" }), "Pathed as Class 80x on electric at 125mph");
  assert.equal(daysRunLabel("0000001"), "SuO");
  assert.equal(allowanceText("Pathing", "02"), "Pathing allowance 1 minute");
  const stops = annotateStops(
    [
      { tpl: "LEEDS" },
      { tpl: "SHIPLEY" },
      { tpl: "SKIPTON" },
    ],
    {
      allowances: [{ tiploc: "LEEDS", pathing: "02" }],
      changes: [{ tiploc: "SHIPLEY", powerType: "DMU", timingLoad: "158", speed: "90" }],
    },
    { powerType: "DMU", timingLoad: "150", speed: "75" },
  );
  assert.equal(stops[0].pathedAs, "Pathed as Class 150/153/155/156 DMU at 75mph");
  assert.deepEqual(stops[0].allowances, ["Pathing allowance 1 minute"]);
  assert.equal(stops[1].pathedAs, "Pathed as Class 158/159 DMU at 90mph");
  assert.equal(stops[2].pathedAs, undefined);
});

test("public schedule fills the overview from the stored service", () => {
  const schedule = publicSchedule({
    svc: { uid: "C32529", headcode: "2H58", category: "OO", power_type: "DMU", timing_load: "150" },
    profile: { tsc: "21869000", headcode: "5908", daysRun: "0000001", runsFrom: "2026-05-17", runsTo: "2026-12-06", seating: "S", reservations: "A", speed: "75" },
    units: ["158754"],
    trust: { train_id: "172H58MM18", activated_at: Date.parse("2026-10-18T11:29:00Z") },
  });
  assert.equal(schedule.identity, "2H58");
  assert.equal(schedule.daysLabel, "SuO - 17/05/2026 to 06/12/2026");
  assert.equal(schedule.categoryLabel, "Ordinary Passenger");
  assert.equal(schedule.seatingLabel, "Standard class only seating");
  assert.equal(schedule.reservationsLabel, "Reservations available");
  assert.equal(schedule.trustId, "172H58MM18");
  assert.match(schedule.activatedAt, /18\/10\/2026 12:29/);
  assert.equal(schedule.pathedAs, "Pathed as Class 150/153/155/156 DMU at 75mph");
});
