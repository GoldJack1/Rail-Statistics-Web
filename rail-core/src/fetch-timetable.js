#!/usr/bin/env node
/**
 * 04:00 UK timetable pull (GCS if configured) then CIF import into day sqlite.
 * Old overlay used fetch-daily-timetables.mjs + gsutil; this is the rail-core equivalent.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { operatingDayYmd } from "./db.js";

const TT_DIR = process.env.TT_DIR ?? "./tt";
mkdirSync(TT_DIR, { recursive: true });

function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

const today = operatingDayYmd();
const tomorrow = addDaysYmd(today, 1);
const gcs = process.env.TT_GCS_URI || process.env.TT_GCS_PREFIX || "";
const gsutil = process.env.GSUTIL_PATH || "gsutil";

if (gcs) {
  const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (cred) process.env.GOOGLE_APPLICATION_CREDENTIALS = cred;
  console.log("fetching timetable objects from", gcs);
  const r = spawnSync(gsutil, ["-m", "cp", "-n", `${gcs.replace(/\/$/, "")}/**`, TT_DIR], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status) console.error("gsutil exit", r.status);
} else {
  console.log("TT_GCS_URI unset — importing any CIF already in", TT_DIR);
}

const files = existsSync(TT_DIR)
  ? readdirSync(TT_DIR).filter((f) => /\.(cif|CIF|txt)$/.test(f))
  : [];
const wanted = files.filter((f) => f.includes(today) || f.includes(tomorrow) || files.length < 8);
const targets = wanted.length ? wanted : files;
if (!targets.length) {
  console.error("no CIF files to import");
  process.exit(0);
}

for (const file of targets) {
  const full = join(TT_DIR, file);
  const dateArg = file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || today;
  console.log("import-tt", file, dateArg);
  const r = spawnSync(process.execPath, ["src/import-tt.js", full, dateArg], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  });
  if (r.status) console.error("import-tt failed", file, r.status);
}
console.log("timetable ingest done");
