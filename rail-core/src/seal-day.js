#!/usr/bin/env node
/**
 * Close-of-day HSP merge for passenger RIDs with missing public actuals.
 * Usage: node src/seal-day.js 2026-09-29
 */
import "./load-env.js";
import { openCatalog, openDayDb, operatingDayYmd, walCheckpoint } from "./db.js";
import { applyHspDetails } from "./hsp-apply.js";
import { hspServiceDetails } from "./hsp-client.js";

function yesterdayYmd() {
  const today = operatingDayYmd();
  const t = Date.parse(`${today}T12:00:00Z`) - 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

const ymd = process.argv[2] || yesterdayYmd();
if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? "")) {
  console.error("usage: node src/seal-day.js YYYY-MM-DD");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const perSec = Math.max(0.5, Number(process.env.HSP_DETAILS_PER_SEC || 2));
const gapMs = Math.round(1000 / perSec);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const catalog = openCatalog(DATA_DIR);
const db = openDayDb(DATA_DIR, ymd);
if (!process.env.NRDP_HSP_USER) {
  console.error("NRDP_HSP_USER/PASSWORD not set; wrote sealed=skipped-no-hsp");
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', 'skipped-no-hsp')`).run();
  walCheckpoint(db);
  db.close();
  catalog.close();
  process.exit(0);
}

const rids = db
  .prepare(
    `SELECT s.rid FROM services s
     WHERE IFNULL(s.service_type, 'passenger') != 'freight'
       AND EXISTS (
         SELECT 1 FROM calls c
         WHERE c.rid = s.rid AND IFNULL(c.is_passing, 0) = 0
           AND (c.sta IS NOT NULL OR c.std IS NOT NULL)
           AND (c.ata IS NULL AND c.atd IS NULL)
       )`,
  )
  .all()
  .map((r) => r.rid);

let filled = 0;
let skipped404 = 0;
let errors = 0;
let authFail = 0;
for (const rid of rids) {
  try {
    const details = await hspServiceDetails(rid);
    filled += applyHspDetails(db, catalog, details, ymd, rid).filled || 0;
    authFail = 0;
  } catch (err) {
    if (err.status === 404) skipped404++;
    else {
      errors++;
      console.error("HSP", rid, err.message);
      if (err.status === 401 || err.status === 403) {
        authFail++;
        if (authFail >= 3) {
          console.error("HSP auth failing — stopping seal");
          break;
        }
      }
    }
  }
  await sleep(gapMs);
}

db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', ?)`).run(new Date().toISOString());
walCheckpoint(db);
console.log(
  `sealed ${ymd}, filled ${filled} stop actuals from HSP across ${rids.length} passenger services (404=${skipped404} err=${errors})`,
);
db.close();
catalog.close();
