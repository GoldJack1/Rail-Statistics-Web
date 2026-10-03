#!/usr/bin/env node
/**
 * 04:00 Europe/London GCS pull (same window as the old daemon).
 * Stage 1: today’s Darwin v8, retried until it lands (files often 04:00–04:30).
 * Stage 2: NLC, TOPS, long-range CIF only after that import succeeds.
 */
import "./load-env.js";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { operatingDayYmd } from "./db.js";
import { addCalendarDays } from "./calendar-day.js";

const TT_DIR = process.env.TT_DIR ?? "./tt";
mkdirSync(TT_DIR, { recursive: true });

const BUCKET = (process.env.TT_GCS_BUCKET || "gs://rail-statistics.firebasestorage.app").replace(/\/$/, "");
const PPT = process.env.TT_GCS_PPT || `${BUCKET}/DARWINTTFILES/PPTimetable`;
const CORPUS = process.env.TT_GCS_CORPUS || `${BUCKET}/DARWINCORPUS`;
const TOPS = process.env.TT_GCS_TOPS || `${BUCKET}/DARWINTOPS`;
const LONG = process.env.TT_GCS_LONG || `${BUCKET}/DARWINLONGRANGETTFILES`;
const cred = process.env.GOOGLE_APPLICATION_CREDENTIALS || "/home/darwin/.config/gcloud/tt-fetch-sa.json";
if (existsSync(cred)) process.env.GOOGLE_APPLICATION_CREDENTIALS = cred;
process.env.CLOUDSDK_CORE_PROJECT = process.env.CLOUDSDK_CORE_PROJECT || "rail-statistics";
const gsutil = process.env.GSUTIL_PATH || "gsutil";

if (existsSync(cred)) {
  spawnSync("gcloud", ["auth", "activate-service-account", `--key-file=${cred}`, "--quiet"], {
    stdio: "inherit",
    env: process.env,
  });
}

function gsCp(pattern, destDir) {
  mkdirSync(destDir, { recursive: true });
  console.log("gsutil cp", pattern);
  const r = spawnSync(gsutil, ["-m", "cp", "-n", pattern, destDir], { stdio: "inherit", env: process.env });
  return r.status === 0;
}

function gsList(prefix) {
  const r = spawnSync(gsutil, ["ls", `${prefix.replace(/\/$/, "")}/**`], {
    encoding: "utf8",
    env: process.env,
  });
  if (r.status) return [];
  return String(r.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("gs://") && !s.endsWith("/"));
}

function pickLatest(uris, matcher) {
  const hits = uris
    .map((uri) => ({ uri, name: basename(uri) }))
    .filter((x) => matcher.test(x.name));
  if (!hits.length) return null;
  hits.sort((a, b) => a.name.localeCompare(b.name));
  return hits[hits.length - 1].uri;
}

function gsCpOne(uri, destDir) {
  if (!uri) return false;
  mkdirSync(destDir, { recursive: true });
  console.log("gsutil cp", uri);
  const r = spawnSync(gsutil, ["cp", "-n", uri, destDir], { stdio: "inherit", env: process.env });
  return r.status === 0;
}

function collectFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) out.push(...collectFiles(p));
    else out.push(p);
  }
  return out;
}

function unpackLongRangeZips(cifDir) {
  if (!existsSync(cifDir)) return;
  const zips = collectFiles(cifDir).filter((f) => /\.zip$/i.test(f)).sort();
  for (const zip of zips) {
    console.log("unzip", zip);
    spawnSync("unzip", ["-o", "-j", zip, "-d", cifDir], {
      stdio: "inherit",
    });
  }
}

function sleepSec(sec) {
  spawnSync("sleep", [String(Math.max(1, Math.round(sec)))], { stdio: "ignore" });
}

function londonHhmm(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false,
  }).format(now);
}

function findTodayV8() {
  return collectFiles(TT_DIR).filter((f) => /v8\.xml(\.gz)?$/i.test(f) && basename(f).includes(compact));
}

function copyTodayV8() {
  return gsCp(`${PPT}/${compact}*v8.xml.gz`, TT_DIR);
}

function runRetry(label, args, attempts = 6, waitMs = 15000) {
  for (let i = 1; i <= attempts; i++) {
    console.log(i === 1 ? label : `${label} (retry ${i}/${attempts})`);
    const r = spawnSync(process.execPath, args, {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
    });
    if (!r.status) return true;
    console.error(label, "failed", r.status);
    if (i < attempts) {
      console.log("waiting", waitMs / 1000, "s for sqlite lock");
      sleepSec(waitMs / 1000);
    }
  }
  return false;
}

const today = operatingDayYmd();
const compact = today.replace(/-/g, "");
const graceMin = Math.min(120, Math.max(5, Number(process.env.TT_FETCH_GRACE_MIN || 35)));
const retrySec = Math.min(120, Math.max(30, Number(process.env.TT_FETCH_RETRY_SEC || 120)));
const deadline = Date.now() + graceMin * 60 * 1000;

console.log(
  `stage 1: Darwin v8 for railway day ${today} (${londonHhmm()} Europe/London, retry ${graceMin}m every ${retrySec}s)`,
);

let todayFiles = findTodayV8();
while (!todayFiles.length && Date.now() < deadline) {
  copyTodayV8();
  todayFiles = findTodayV8();
  if (todayFiles.length) break;
  const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  console.warn(`today’s PPTimetable still missing (typical until ~04:30). retry in ${retrySec}s, ${left}s left in window`);
  if (left < retrySec) break;
  sleepSec(retrySec);
}
if (!todayFiles.length) copyTodayV8();
todayFiles = findTodayV8();

let ttOk = false;
if (!todayFiles.length) {
  console.error("no today’s v8 PPTimetable — keeping previous timetable, skipping NLC/TOPS/CIF");
} else {
  ttOk = todayFiles.every((full) => runRetry("import-pptimetable", ["src/import-pptimetable.js", full, today]));
}

if (!ttOk) {
  console.error("Darwin v8 import did not succeed — not starting NLC/TOPS/long-range");
  process.exit(1);
}

console.log("stage 2: NLC, TOPS, long-range (after v8 ok)");
gsCpOne(pickLatest(gsList(CORPUS), /^NLC.*\.xml\.gz$/i), TT_DIR);
gsCpOne(pickLatest(gsList(TOPS), /^tops-location.*\.csv$/i), TT_DIR);
runRetry("fetch-corpus", ["src/fetch-corpus.js"]);

if (process.env.TT_IMPORT_CIF !== "0") {
  gsCpOne(
    pickLatest(gsList(LONG), /timetable_full.*\.zip$/i) || pickLatest(gsList(LONG), /\.zip$/i),
    join(TT_DIR, "cif"),
  );
  unpackLongRangeZips(join(TT_DIR, "cif"));
  const cifFiles = collectFiles(join(TT_DIR, "cif"))
    .filter((f) => /MCA|\.cif/i.test(basename(f)))
    .sort();
  const latestCif = cifFiles[cifFiles.length - 1];
  if (latestCif) {
    const ahead = String(Math.min(28, Math.max(0, Number(process.env.TT_CIF_AHEAD_DAYS ?? 14) || 0)));
    const from = addCalendarDays(today, 1);
    console.log("CIF from", from, "ahead", ahead, "(skips Darwin operating day)");
    runRetry("import-tt", ["src/import-tt.js", latestCif, from, ahead]);
  }
  else console.log("no CIF MCA in tt/cif");
}

console.log("timetable ingest done");

