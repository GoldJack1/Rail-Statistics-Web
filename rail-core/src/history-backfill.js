#!/usr/bin/env node
/**
 * Import dated PPTimetable v8 from GCS (when present) and HSP-seal public actuals.
 * Usage: node src/history-backfill.js --from 2025-10-01 --to 2026-09-29
 * Does not invent TRUST pass actuals.
 */
import "./load-env.js";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { dayPath, openDayDb } from "./db.js";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const from = flag("--from");
const to = flag("--to");
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
  console.error("usage: node src/history-backfill.js --from YYYY-MM-DD --to YYYY-MM-DD [--force] [--tt-only]");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TT_DIR = process.env.TT_DIR ?? "./tt";
const BUCKET = (process.env.TT_GCS_BUCKET || "gs://rail-statistics.firebasestorage.app").replace(/\/$/, "");
const PPT = process.env.TT_GCS_PPT || `${BUCKET}/DARWINTTFILES/PPTimetable`;
const gsutil = process.env.GSUTIL_PATH || "gsutil";
const force = args.includes("--force");
const ttOnly = args.includes("--tt-only");

function ymds(a, b) {
  const out = [];
  let t = Date.parse(`${a}T12:00:00Z`);
  const end = Date.parse(`${b}T12:00:00Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

mkdirSync(TT_DIR, { recursive: true });

for (const ymd of ymds(from, to)) {
  const compact = ymd.replace(/-/g, "");
  const path = dayPath(DATA_DIR, ymd);
  let count = 0;
  if (existsSync(path)) {
    const db = openDayDb(DATA_DIR, ymd);
    count = db.prepare(`SELECT COUNT(*) AS n FROM services`).get().n;
    db.close();
  }
  if (count > 0 && !force) {
    console.log(ymd, "skip existing", count, "services");
    continue;
  }

  console.log(ymd, "fetch v8");
  spawnSync(gsutil, ["-m", "cp", "-n", `${PPT}/${compact}*v8.xml.gz`, TT_DIR], {
    stdio: "inherit",
    env: process.env,
  });
  const files = existsSync(TT_DIR)
    ? readdirSync(TT_DIR).filter((n) => n.includes(compact) && /v8\.xml/i.test(n)).map((n) => join(TT_DIR, n))
    : [];
  const xml = files.sort()[0];
  if (xml) {
    spawnSync(process.execPath, ["src/import-pptimetable.js", xml, ymd], { stdio: "inherit", env: process.env });
  } else {
    console.warn(ymd, "no dated v8 — HSP-only public stops if RIDs already known");
  }
  if (!ttOnly) {
    spawnSync(process.execPath, ["src/seal-day.js", ymd], { stdio: "inherit", env: process.env });
  }
  console.log(ymd, ttOnly ? "tt imported" : "backfill done", basename(xml || "no-tt"));
}
