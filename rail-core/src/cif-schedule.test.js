import { test } from "node:test";
import assert from "node:assert/strict";
import { cifBsRunsOn, cifWeekdayIndex } from "./cif-schedule.js";

function bs({ days = "0000100", stp = "P", txn = "N" } = {}) {
  return (`BS${txn}UID001260518261207${days} PXX1S25`).padEnd(79, " ") + stp;
}

test("CIF weekday index is Mon=0", () => {
  assert.equal(cifWeekdayIndex("2026-10-02"), 4);
});

test("CIF BS runs on matching day-of-week inside the date range", () => {
  const line = bs();
  assert.equal(cifBsRunsOn(line, "2026-10-02"), true);
  assert.equal(cifBsRunsOn(line, "2026-10-01"), false);
  assert.equal(cifBsRunsOn(line, "2026-05-17"), false);
});

test("CIF BS skips cancellations and deletes", () => {
  const cancel = bs({ days: "1111111", stp: "C" });
  const del = bs({ days: "1111111", txn: "D" });
  assert.equal(cifBsRunsOn(cancel, "2026-10-02"), false);
  assert.equal(cifBsRunsOn(del, "2026-10-02"), false);
});
