#!/usr/bin/env node
/**
 * 04:00 Europe/London GCS pull (same window as the old daemon).
 * Stage 1: today’s Darwin v8 (--replace so CIF tails from the previous night cannot stick).
 * Stage 2: NLC, TOPS, long-range CIF only after that import succeeds (from tomorrow).
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
const BPLAN = process.env.TT_GCS_BPLAN || `${BUCKET}/BPLAN`;
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

function gsCpOne(uri, destDir, { skipExisting = true } = {}) {
  if (!uri) return false;
  mkdirSync(destDir, { recursive: true });
  console.log("gsutil cp", uri, skipExisting ? "(skip existing)" : "(replace)");
  const args = skipExisting ? ["cp", "-n", uri, destDir] : ["cp", uri, destDir];
  const r = spawnSync(gsutil, args, { stdio: "inherit", env: process.env });
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
    const unzip = spawnSync("unzip", ["-o", "-j", zip, "-d", cifDir], { stdio: "inherit" });
    if (!unzip.status) continue;
    console.log("unzip missing/failed, using python zipfile");
    const py = spawnSync(
      process.execPath.replace(/node$/, "python3") === process.execPath ? "python3" : "python3",
      [
        "-c",
        "import zipfile,sys,os; d=sys.argv[2]; z=zipfile.ZipFile(sys.argv[1]);\n" +
          "os.makedirs(d,exist_ok=True)\n" +
          "[open(os.path.join(d, os.path.basename(i.filename)),'wb').write(z.read(i)) for i in z.infolist() if i.filename and not i.is_dir()]",
        zip,
        cifDir,
      ],
      { stdio: "inherit" },
    );
    if (py.status) console.error("python unzip failed", py.status);
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
  ttOk = todayFiles.every((full) =>
    runRetry("import-pptimetable", ["src/import-pptimetable.js", "--replace", full, today]),
  );
}

if (!ttOk) {
  console.error("Darwin v8 import did not succeed — not starting NLC/TOPS/long-range");
  process.exit(1);
}

console.log("stage 2: NLC, TOPS, long-range (after v8 ok)");
gsCpOne(pickLatest(gsList(CORPUS), /^NLC.*\.xml\.gz$/i), TT_DIR);
gsCpOne(pickLatest(gsList(TOPS), /^tops-location.*\.csv$/i), TT_DIR);
runRetry("fetch-corpus", ["src/fetch-corpus.js"]);
runRetry("fetch-smart", ["src/fetch-smart.js"]);

if (process.env.TT_IMPORT_BPLAN !== "0") {
  const bplanDir = join(TT_DIR, "bplan");
  mkdirSync(bplanDir, { recursive: true });
  const bplanUri = pickLatest(gsList(BPLAN), /PIF\d+\.txt\.gz$/i);
  if (bplanUri) {
    gsCpOne(bplanUri, bplanDir, { skipExisting: true });
    console.log("BPLAN PIF staged", basename(bplanUri), "→", bplanDir);
  } else {
    console.log("no BPLAN PIF in", BPLAN);
  }
}

// Daily ITPS JSON is usually not ready at 04:00 UK — rail-core-schedule.timer (~06:30) overlays it.
if (process.env.TT_IMPORT_ITPS !== "0") {
  console.log("stage 2b: ITPS overlay deferred to rail-core-schedule (~06:30 Europe/London)");
}

if (process.env.TT_IMPORT_CIF !== "0") {
  gsCpOne(
    pickLatest(gsList(LONG), /timetable_full.*\.zip$/i) || pickLatest(gsList(LONG), /\.zip$/i),
    join(TT_DIR, "cif"),
    { skipExisting: false },
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
  } else console.log("no CIF MCA in tt/cif for future days");
}

console.log("timetable ingest done");

