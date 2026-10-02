#!/usr/bin/env node
/**
 * Close-of-day HSP merge for passenger RIDs with missing public actuals.
 * Usage: node src/seal-day.js 2026-09-29
 */
import "./load-env.js";
import { openCatalog, openDayDb, operatingDayYmd, walCheckpoint } from "./db.js";
import { applyHspDetails } from "./hsp-apply.js";
import { hspServiceDetails, mapHspLimited } from "./hsp-client.js";
import { ridsNeedingHspSeal } from "./hsp-seal-rids.js";

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
const skipForecastOnly = process.env.HSP_SKIP_FORECAST_ONLY !== "0";

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

const rids = ridsNeedingHspSeal(db, { skipForecastOnly });
console.log(`HSP seal ${ymd}: ${rids.length} RIDs (skipForecastOnly=${skipForecastOnly})`);

let filled = 0;
let skipped404 = 0;
let errors = 0;
let authFail = 0;
let stop = false;

const results = await mapHspLimited(rids, async (rid, idx) => {
  if (stop) return { rid, skip: true };
  try {
    const details = await hspServiceDetails(rid);
    return { rid, details };
  } catch (err) {
    if (err.status === 404) return { rid, miss: true };
    if (err.status === 401 || err.status === 403) {
      authFail++;
      if (authFail >= 3) stop = true;
    }
    return { rid, err };
  } finally {
    if ((idx + 1) % 250 === 0) console.log(`HSP seal progress ${idx + 1}/${rids.length}`);
  }
});

const mark = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
for (const row of results) {
  if (!row || row.skip) continue;
  if (row.miss) {
    skipped404++;
    mark.run(`hsp_miss_${row.rid}`, ymd);
    continue;
  }
  if (row.err) {
    errors++;
    console.error("HSP", row.rid, row.err.message);
    continue;
  }
  filled += applyHspDetails(db, catalog, row.details, ymd, row.rid).filled || 0;
}

db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', ?)`).run(new Date().toISOString());
walCheckpoint(db);
console.log(
  `sealed ${ymd}, filled ${filled} stop actuals from HSP across ${rids.length} passenger services (404=${skipped404} err=${errors})`,
);
db.close();
catalog.close();
