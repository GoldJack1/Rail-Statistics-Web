#!/usr/bin/env node
/**
 * Download Network Rail SMART berth→STANOX reference (SupportingFileAuthenticate).
 * Auth: NR_STOMP_USER / NR_STOMP_PASSWORD (same as ITPS/CORPUS).
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
  renameSync,
  unlinkSync,
  statSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { importSmartPayload, parseSmartPayload } from "./import-smart.js";
import { openCatalog } from "./db.js";

const TT_DIR = process.env.TT_DIR ?? "./tt";
const REF_DIR = process.env.TT_SMART_DIR ?? join(TT_DIR, "ref");
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const user = process.env.NR_STOMP_USER || process.env.NR_SCHEDULE_USER || "";
const pass = process.env.NR_STOMP_PASSWORD || process.env.NR_SCHEDULE_PASSWORD || "";
const SMART_URL =
  process.env.NR_SMART_URL ||
  "https://publicdatafeeds.networkrail.co.uk/ntrod/SupportingFileAuthenticate?type=SMART";

mkdirSync(REF_DIR, { recursive: true });

const META_PATH = join(REF_DIR, "smart-meta.json");
const DEST_GZ = join(REF_DIR, "smart.json.gz");
const DEST_JSON = join(REF_DIR, "smart.json");

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
  console.log("GET SMART", basename(dest));
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`SMART download ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("SMART download empty body");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const st = statSync(dest);
  if (st.size < 100) throw new Error(`SMART download too small (${st.size} bytes)`);
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

export function readSmartMeta() {
  if (!existsSync(META_PATH)) return null;
  try {
    return JSON.parse(readFileSync(META_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function pickLocalSmartFile() {
  if (process.env.SMART_PATH && existsSync(process.env.SMART_PATH)) return process.env.SMART_PATH;
  if (existsSync(DEST_JSON)) return DEST_JSON;
  if (existsSync(DEST_GZ)) return DEST_GZ;
  return null;
}

/**
 * @returns {Promise<{ path: string|null, meta: object|null, imported: number }>}
 */
export async function fetchAndImportSmart() {
  if (process.env.TT_IMPORT_SMART === "0") {
    console.log("TT_IMPORT_SMART=0 — skipping SMART fetch");
    const local = pickLocalSmartFile();
    if (!local) return { path: null, meta: readSmartMeta(), imported: 0 };
    const cat = openCatalog(DATA_DIR);
    const n = importSmartPayload(cat, parseSmartPayload(readFileSync(local)));
    cat.close();
    return { path: local, meta: readSmartMeta(), imported: n };
  }

  let path = null;
  if (user && pass) {
    try {
      const tmp = join(REF_DIR, `smart-dl-${Date.now()}`);
      await download(SMART_URL, tmp);
      if (isGzip(tmp)) {
        await maybeGunzip(tmp, DEST_JSON);
        try {
          renameSync(tmp, DEST_GZ);
        } catch {
          try {
            unlinkSync(tmp);
          } catch {
            /* ignore */
          }
        }
        path = DEST_JSON;
      } else {
        renameSync(tmp, DEST_JSON);
        path = DEST_JSON;
      }
      writeMeta({ source: "nrod-smart", bytes: statSync(path).size });
    } catch (err) {
      console.warn("SMART fetch failed:", String(err.message || err));
    }
  } else {
    console.warn("NR_STOMP_USER/PASSWORD missing — cannot fetch SMART");
  }

  if (!path) path = pickLocalSmartFile();
  if (!path) return { path: null, meta: readSmartMeta(), imported: 0 };

  const cat = openCatalog(DATA_DIR);
  const n = importSmartPayload(cat, parseSmartPayload(readFileSync(path)));
  cat.close();
  console.log("SMART steps imported", n, "from", path);
  return { path, meta: readSmartMeta(), imported: n };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const out = await fetchAndImportSmart();
  if (!out.path && !out.imported) process.exit(1);
  console.log(JSON.stringify({ path: out.path, imported: out.imported, meta: out.meta }));
}
