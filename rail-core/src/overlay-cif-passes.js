#!/usr/bin/env node
/**
 * Splice CIF/ITPS working TIPLOCs onto today’s Darwin journeys where the path matches.
 * Usage: node src/overlay-cif-passes.js <cif-file> [YYYY-MM-DD]
 */
import { operatingDayYmd } from "./db.js";
import { applyWorkingsOverlay, loadScheduleWorkings } from "./cif-overlay.js";
import { stitchOrmPathsForDay } from "./orm-path.js";

const file = process.argv[2];
const ymd = process.argv[3] || operatingDayYmd();
const DATA_DIR = process.env.DATA_DIR ?? "./data";
if (!file) {
  console.error("usage: node src/overlay-cif-passes.js <cif-or-json-file> [YYYY-MM-DD]");
  process.exit(1);
}

const workings = await loadScheduleWorkings(file, ymd);
const out = applyWorkingsOverlay(DATA_DIR, ymd, workings);
console.log(
  `overlay-cif-passes ${ymd} services=${out.services} inserted=${out.inserted} cifOnly=${out.cifOnly || 0} workings=${out.workings}`,
);
if (String(process.env.TT_ORM_PATH ?? "1").trim() !== "0") {
  const stitch = stitchOrmPathsForDay(DATA_DIR, ymd, { scheduleFile: file });
  console.log("overlay-cif-passes orm", stitch);
}
