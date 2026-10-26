import { test } from "node:test";
import assert from "node:assert/strict";
import { auditBplanExtract, parseBplanRecord, parseSectionalRunningTime } from "./import-bplan.js";

test("LOC, NWK and TLK match the S529 examples", () => {
  const loc = parseBplanRecord(
    "LOC\tA\tABGLELE\tAbergele & Pensarn\t01-01-1995 00:00:00\t\t294600\t378700\tO\t6\t40073\tN\t ",
  );
  assert.equal(loc.tiploc, "ABGLELE");
  assert.equal(loc.name, "Abergele & Pensarn");
  assert.equal(loc.easting, 294600);
  assert.equal(loc.northing, 378700);
  assert.equal(loc.timingPointType, "O");
  assert.equal(loc.stanox, "40073");
  assert.equal(loc.offNetwork, "N");
  assert.equal(loc.end, null);

  const nwk = parseBplanRecord(
    "NWK\tA\tABCWM\tFERNHIL\t   \t\t01-01-1995 00:00:00\t\tD\tD\t00482\tN\tY\tN\t5\tN\t \t0\t",
  );
  assert.equal(nwk.fromTiploc, "ABCWM");
  assert.equal(nwk.toTiploc, "FERNHIL");
  assert.equal(nwk.line, null);
  assert.equal(nwk.distanceM, 482);
  assert.equal(nwk.initialDirection, "D");
  assert.equal(nwk.dooPassenger, "N");
  assert.equal(nwk.dooNonPassenger, "Y");

  const tlk = parseBplanRecord(
    "TLK\tA\tABCWM\tABDARE\t   \t150\t     \t75\t \t0\t0\t28-09-2003 00:00:00\t\t+05'30\t",
  );
  assert.equal(tlk.traction, "150");
  assert.equal(tlk.speed, 75);
  assert.equal(tlk.entrySpeed, 0);
  assert.equal(tlk.exitSpeed, 0);
  assert.equal(tlk.runningSeconds, 330);
  assert.equal(parseSectionalRunningTime("-05'00"), -300);
});

test("PIT totals have to match the records in the extract", () => {
  const text = [
    "PIF\t1\tCENTRE\tNR\t16-05-2027 00:00:00\t11-12-2027 23:59:59\tI\tD\t16-10-2026 19:01:42\t1",
    "REF\tA\tTCL\t2\tOrdinary Passenger",
    "LOC\tA\tABGLELE\tAbergele & Pensarn\t01-01-1995 00:00:00\t\t294600\t378700\tO\t6\t40073\tN\t ",
    "NWK\tA\tABCWM\tFERNHIL\t   \t\t01-01-1995 00:00:00\t\tD\tD\t00482\tN\tY\tN\t5\tN\t \t0\t",
    "PIT\tREF\t1\t0\t0\tTLD\t0\t0\t0\tLOC\t1\t0\t0\tPLT\t0\t0\t0\tNWK\t1\t0\t0\tTLK\t0\t0\t0",
    "",
  ].join("\n");
  const audit = auditBplanExtract(text);
  assert.equal(audit.header.cycleType, "I");
  assert.equal(audit.header.cycleStage, "D");
  assert.equal(audit.header.timetableStart, "2027-05-16T00:00:00");
  assert.deepEqual(audit.counts, { REF: 1, LOC: 1, NWK: 1 });
});
