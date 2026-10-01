import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import { openCatalog } from "./db.js";
import { applyPtacUnit, lookupConsist, replayPtac } from "./ptac-apply.js";
import { parsePtacMessage } from "./parse-ptac.js";

const SAMPLE_XML = `<?xml version="1.0"?>
<PassengerTrainConsistMessage>
  <TrainOperationalIdentification>
    <TransportOperationalIdentifiers>
      <Company>9925</Company>
      <Core>1P90G24937</Core>
      <StartDate>2026-09-30</StartDate>
    </TransportOperationalIdentifiers>
  </TrainOperationalIdentification>
  <OperationalTrainNumberIdentifier>
    <OperationalTrainNumber>1P90</OperationalTrainNumber>
  </OperationalTrainNumberIdentifier>
  <Allocation>
    <TrainOriginLocation>
      <LocationSubsidiaryIdentification>
        <LocationSubsidiaryCode>LEEDS</LocationSubsidiaryCode>
      </LocationSubsidiaryIdentification>
    </TrainOriginLocation>
    <TrainOriginDateTime>2026-09-30T10:00:00</TrainOriginDateTime>
    <ResourceGroup>
      <ResourceGroupId>185111</ResourceGroupId>
      <FleetId>185</FleetId>
      <Vehicle>
        <VehicleId>18511101</VehicleId>
        <ResourcePosition>1</ResourcePosition>
      </Vehicle>
    </ResourceGroup>
  </Allocation>
</PassengerTrainConsistMessage>`;

test("PTAC parser yields join key and unit id from S506 XML", () => {
  const parsed = parsePtacMessage({ bytes: SAMPLE_XML });
  assert.equal(parsed.headcode, "1P90");
  assert.equal(parsed.uid, "G24937");
  assert.equal(parsed.originTpl, "LEEDS");
  assert.equal(parsed.originHHMM, "10:00");
  assert.deepEqual(parsed.unitIds, ["185111"]);
  assert.equal(parsed.operatingDay, "2026-09-30");
});

test("PTAC persist is UID+SSD and does not need a service row", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptac-"));
  const cat = openCatalog(dir);
  const parsed = parsePtacMessage({ bytes: SAMPLE_XML });
  const out = applyPtacUnit(cat, {
    unit_id: "185111",
    core: parsed.core,
    uid: parsed.uid,
    operating_day: parsed.operatingDay,
    headcode: parsed.headcode,
    originTpl: parsed.originTpl,
    originHHMM: parsed.originHHMM,
    json: parsed.json,
  });
  assert.equal(out.ok, true);
  assert.equal(out.uid, "G24937");
  const row = lookupConsist(cat, { uid: "G24937", ssd: "2026-09-30", originHHMM: "10:00" });
  assert.ok(row);
  assert.equal(JSON.parse(row.unit_ids)[0], "185111");
  assert.equal(replayPtac(), 0);
  cat.close();
});

test("two diagrams same unit keep separate consist JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "ptac-two-"));
  const cat = openCatalog(dir);
  applyPtacUnit(cat, {
    unit_id: "185111",
    uid: "G24937",
    operating_day: "2026-09-30",
    headcode: "1P90",
    originHHMM: "10:00",
    json: { core: "a", allocations: [{ diagramNo: "A" }] },
  });
  applyPtacUnit(cat, {
    unit_id: "185111",
    uid: "G24999",
    operating_day: "2026-09-30",
    headcode: "1P91",
    originHHMM: "12:00",
    json: { core: "b", allocations: [{ diagramNo: "B" }] },
  });
  const a = lookupConsist(cat, { uid: "G24937", ssd: "2026-09-30" });
  const b = lookupConsist(cat, { uid: "G24999", ssd: "2026-09-30" });
  assert.equal(JSON.parse(a.json).allocations[0].diagramNo, "A");
  assert.equal(JSON.parse(b.json).allocations[0].diagramNo, "B");
  cat.close();
});
