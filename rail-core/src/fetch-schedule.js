#!/usr/bin/env node
/**
 * Download Network Rail ITPS SCHEDULE for Darwin WTT overlay.
 * Prefer daily JSON (~06:00 UTC). CIF weekly full + daily update is the fallback.
 * Auth: NR_STOMP_USER / NR_STOMP_PASSWORD.
 */
import "./load-env.js";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const TT_DIR = process.env.TT_DIR ?? "./tt";
const SCHED_DIR = process.env.TT_SCHEDULE_DIR ?? join(TT_DIR, "schedule");
const user = process.env.NR_STOMP_USER || process.env.NR_SCHEDULE_USER || "";
const pass = process.env.NR_STOMP_PASSWORD || process.env.NR_SCHEDULE_PASSWORD || "";
const base =
  process.env.NR_SCHEDULE_URL ||
  "https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full";
const updateUrl = (day) =>
  process.env.NR_SCHEDULE_UPDATE_URL ||
  `https://publicdatafeeds.networkrail.co.uk/ntrod/CifFileAuthenticate?type=CIF_ALL_UPDATE_DAILY&day=toc-update-${day}`;

mkdirSync(SCHED_DIR, { recursive: true });

const META_PATH = join(SCHED_DIR, "itps-meta.json");

function authHeader() {
  if (!user || !pass) return null;
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function isGzip(path) {
  const fd = openSync(path, "r");
  const magic = Buffer.alloc(2);
  readSync(fd, magic, 0, 2, 0);
  closeSync(fd);
  return magic[0] === 0x1f && magic[1] === 0x8b;
}

async function download(url, dest) {
  const headers = {};
  const auth = authHeader();
  if (auth) headers.Authorization = auth;
  console.log("GET ITPS", basename(dest));
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`schedule download ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("schedule download empty body");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const st = statSync(dest);
  if (st.size < 1000) throw new Error(`schedule download too small (${st.size} bytes)`);
  return dest;
}

async function maybeGunzip(src, dest) {
  if (isGzip(src)) {
    console.log("gunzip", basename(src), "->", basename(dest));
    await pipeline(createReadStream(src), createGunzip(), createWriteStream(dest));
    return dest;
  }
  await pipeline(createReadStream(src), createWriteStream(dest));
  return dest;
}

function writeMeta(meta) {
  writeFileSync(META_PATH, JSON.stringify({ ...meta, fetchedAt: new Date().toISOString() }, null, 2));
}

export function readItpsMeta() {
  if (!existsSync(META_PATH)) return null;
  try {
    return JSON.parse(readFileSync(META_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function pickLocalItpsFile() {
  if (!existsSync(SCHED_DIR)) return null;
  const prefer = [join(SCHED_DIR, "toc-full.json"), join(SCHED_DIR, "toc-full.CIF")];
  for (const p of prefer) {
    if (existsSync(p) && statSync(p).size > 1000) return p;
  }
  const files = readdirSync(SCHED_DIR)
    .filter((n) => /\.(cif|json)$/i.test(n) || /MCA/i.test(n))
    .map((n) => join(SCHED_DIR, n))
    .filter((p) => statSync(p).size > 1000)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || null;
}

/** Previous English weekday name for CIF_ALL_UPDATE_DAILY (wiki: request previous day). */
export function cifUpdateDayName(now = new Date()) {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  // Use Europe/London calendar day, then previous weekday.
  const london = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(now);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const idx = map[london] ?? now.getUTCDay();
  const prev = (idx + 6) % 7;
  return days[prev];
}

async function fetchJsonFull() {
  const gzPath = join(SCHED_DIR, "toc-full.json.gz");
  const jsonPath = join(SCHED_DIR, "toc-full.json");
  await download(base, gzPath);
  await maybeGunzip(gzPath, jsonPath);
  // JSON lines should start with { 
  const head = createReadStream(jsonPath, { start: 0, end: 80, encoding: "utf8" });
  let sample = "";
  for await (const chunk of head) sample += chunk;
  if (!sample.trimStart().startsWith("{") && !sample.includes("JsonSchedule")) {
    throw new Error("downloaded file does not look like SCHEDULE JSON");
  }
  writeMeta({ source: "json-full", path: jsonPath, bytes: statSync(jsonPath).size });
  console.log("ITPS JSON SCHEDULE ready", jsonPath);
  return jsonPath;
}

async function fetchCifFallback() {
  const gzPath = join(SCHED_DIR, "toc-full.CIF.gz");
  const cifPath = join(SCHED_DIR, "toc-full.CIF");
  await download(`${base}.CIF.gz`, gzPath);
  await maybeGunzip(gzPath, cifPath);
  const day = cifUpdateDayName();
  const updateGz = join(SCHED_DIR, `toc-update-${day}.CIF.gz`);
  const updatePath = join(SCHED_DIR, `toc-update-${day}.CIF`);
  try {
    await download(`${updateUrl(day)}.CIF.gz`, updateGz);
    await maybeGunzip(updateGz, updatePath);
    console.log("ITPS CIF update ready", updatePath);
  } catch (err) {
    console.warn("CIF daily update skipped:", String(err.message || err));
  }
  writeMeta({
    source: "cif-weekly+update",
    path: cifPath,
    updatePath: existsSync(updatePath) ? updatePath : null,
    updateDay: day,
    bytes: statSync(cifPath).size,
  });
  console.log("ITPS CIF SCHEDULE ready", cifPath);
  return cifPath;
}

/**
 * @returns {Promise<{ path: string|null, meta: object|null }>}
 */
export async function fetchItpsSchedule() {
  if (process.env.TT_IMPORT_ITPS === "0") {
    console.log("TT_IMPORT_ITPS=0 — skipping ITPS SCHEDULE");
    const local = pickLocalItpsFile();
    return { path: local, meta: readItpsMeta() };
  }
  if (!user || !pass) {
    console.warn("NR_STOMP_USER/PASSWORD missing — cannot fetch ITPS SCHEDULE");
    const local = pickLocalItpsFile();
    return { path: local, meta: readItpsMeta() };
  }

  try {
    const path = await fetchJsonFull();
    return { path, meta: readItpsMeta() };
  } catch (err) {
    console.warn("ITPS JSON fetch failed:", String(err.message || err));
  }

  try {
    const path = await fetchCifFallback();
    return { path, meta: readItpsMeta() };
  } catch (err) {
    console.warn("ITPS CIF fallback failed:", String(err.message || err));
  }

  const local = pickLocalItpsFile();
  return { path: local, meta: readItpsMeta() };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { path, meta } = await fetchItpsSchedule();
  console.log(path || "no schedule file");
  if (meta) console.log("meta", JSON.stringify(meta));
  if (!path) process.exit(1);
}
