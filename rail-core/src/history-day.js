#!/usr/bin/env node
/**
 * Local history build for one operating day:
 *   node src/history-day.js 2026-09-29 --from DEW --to MCV --from-time 1600 --to-time 1700
 *   node src/history-day.js 2026-09-29 --rid 202609297115813
 * HSP fills public actuals. Pass rows only appear if a timetable was imported for that RID.
 */
import "./load-env.js";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { openCatalog, openDayDb } from "./db.js";
import { applyHspDetails } from "./hsp-apply.js";
import { hspServiceDetails, hspServiceMetrics, ridsFromMetrics, weekdayKind } from "./hsp-client.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const args = process.argv.slice(2);
const ymd = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!ymd) {
  console.error("usage: node src/history-day.js YYYY-MM-DD [--from CRS --to CRS --from-time HHMM --to-time HHMM] [--rid RID]");
  process.exit(1);
}

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function seedCatalog() {
  const seed = join(ROOT, "data-seed", "tiploc-crs.json");
  if (!existsSync(seed)) return;
  spawnSync(process.execPath, ["src/import-crs-map.js", seed], { cwd: ROOT, env: process.env, stdio: "inherit" });
}

const ttDir = process.env.TT_DIR ?? join(ROOT, "tt");
function importLocalTimetable() {
  if (!existsSync(ttDir)) return;
  const compact = ymd.replace(/-/g, "");
  const files = readdirSync(ttDir).filter((n) => n.includes(compact) || n.includes(ymd));
  const xml = files.find((n) => /v8\.xml/i.test(n));
  const cif = files.find((n) => /\.cif$/i.test(n) || /\.CIF$/.test(n));
  if (xml) {
    spawnSync(process.execPath, ["src/import-pptimetable.js", join(ttDir, xml), ymd], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
  } else if (cif) {
    spawnSync(process.execPath, ["src/import-tt.js", join(ttDir, cif), ymd], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    });
  }
}

seedCatalog();
importLocalTimetable();

const catalog = openCatalog(DATA_DIR);
const db = openDayDb(DATA_DIR, ymd);
const rids = new Set();
const explicitRid = flag("--rid");
if (explicitRid) rids.add(explicitRid);

const from = flag("--from");
const to = flag("--to");
if (from && to) {
  const metrics = await hspServiceMetrics({
    from,
    to,
    fromTime: flag("--from-time") || "0000",
    toTime: flag("--to-time") || "2359",
    ymd,
    days: weekdayKind(ymd),
  });
  for (const rid of ridsFromMetrics(metrics)) rids.add(rid);
}

if (!rids.size) {
  for (const row of db.prepare(`SELECT rid FROM services`).all()) rids.add(row.rid);
}

if (!rids.size) {
  console.error("no RIDs: pass --from/--to, --rid, or import a timetable first");
  process.exit(1);
}

let ok = 0;
let filled = 0;
for (const rid of rids) {
  try {
    const details = await hspServiceDetails(rid);
    const out = applyHspDetails(db, catalog, details, ymd, rid);
    if (out.ok) {
      ok++;
      filled += out.filled;
      console.log("sealed", rid, "filled", out.filled);
    }
  } catch (err) {
    console.error("skip", rid, err.message);
  }
}
db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', ?)`).run(new Date().toISOString());
console.log(`history ${ymd}: ${ok}/${rids.size} services, ${filled} public actuals`);
db.close();
catalog.close();
