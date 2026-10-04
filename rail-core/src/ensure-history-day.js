import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { dayPath, openCatalog, openDayDb, operatingDayYmd } from "./db.js";
import { applyHspDetails } from "./hsp-apply.js";
import { hspServiceDetails } from "./hsp-client.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TT_DIR = process.env.TT_DIR ?? "./tt";
const BUCKET = (process.env.TT_GCS_BUCKET || "gs://rail-statistics.firebasestorage.app").replace(/\/$/, "");
const PPT = process.env.TT_GCS_PPT || `${BUCKET}/DARWINTTFILES/PPTimetable`;
const gsutil = process.env.GSUTIL_PATH || "gsutil";

const importing = new Map();
const hspOnce = new Map();

function serviceCount(ymd) {
  const p = dayPath(DATA_DIR, ymd);
  if (!existsSync(p)) return 0;
  const db = openDayDb(DATA_DIR, ymd);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM services`).get().n;
  db.close();
  return n;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("error", reject);
    child.on("exit", (code) => (code ? reject(new Error(`${cmd} ${code}`)) : resolve()));
  });
}

export async function ensureDayImported(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return false;
  if (serviceCount(ymd) > 0) return true;
  if (importing.has(ymd)) return importing.get(ymd);
  const job = (async () => {
    mkdirSync(TT_DIR, { recursive: true });
    const compact = ymd.replace(/-/g, "");
    try {
      await run(gsutil, ["-m", "cp", "-n", `${PPT}/${compact}*v8.xml.gz`, TT_DIR]);
    } catch {
      /* missing object */
    }
    const files = existsSync(TT_DIR)
      ? readdirSync(TT_DIR)
          .filter((n) => n.includes(compact) && /v8\.xml/i.test(n))
          .map((n) => join(TT_DIR, n))
          .sort()
      : [];
    if (files[0]) {
      await run(process.execPath, ["src/import-pptimetable.js", "--replace", files[0], ymd]);
      return serviceCount(ymd) > 0;
    }
    const cifDir = join(TT_DIR, "cif");
    const mca = existsSync(cifDir)
      ? readdirSync(cifDir, { recursive: true })
          .map((n) => join(cifDir, n))
          .filter((p) => /MCA|\.cif$/i.test(p))
          .sort()
          .at(-1)
      : null;
    if (!mca) return serviceCount(ymd) > 0;
    await run(process.execPath, ["src/import-tt.js", mca, ymd, "0"]);
    return serviceCount(ymd) > 0;
  })();
  importing.set(ymd, job);
  try {
    return await job;
  } finally {
    importing.delete(ymd);
  }
}

export function ridNeedsHsp(db, rid) {
  const row = db
    .prepare(
      `SELECT 1 AS n FROM calls
       WHERE rid = ? AND IFNULL(is_passing, 0) = 0
         AND (sta IS NOT NULL OR std IS NOT NULL)
         AND ata IS NULL AND atd IS NULL
       LIMIT 1`,
    )
    .get(rid);
  return Boolean(row);
}

export async function fillServiceHsp(ymd, rid) {
  if (!process.env.NRDP_HSP_USER || !rid) return false;
  if (ymd > operatingDayYmd()) return false;
  const key = `${ymd}:${rid}`;
  if (hspOnce.has(key)) return hspOnce.get(key);
  const job = (async () => {
    const db = openDayDb(DATA_DIR, ymd);
    try {
      if (!ridNeedsHsp(db, rid)) return false;
      const last = db
        .prepare(
          `SELECT atd, ata, atp FROM calls WHERE rid = ? ORDER BY seq DESC`,
        )
        .all(rid);
      const latest = last.map((c) => c.atd || c.ata || c.atp).find(Boolean);
      const { operatingDayYmd } = await import("./db.js");
      const { locationIsFresh } = await import("./location.js");
      if (ymd >= operatingDayYmd() && (!latest || locationIsFresh(latest, ymd, new Date()))) {
        hspOnce.delete(key);
        return false;
      }
      const details = await hspServiceDetails(rid);
      const cat = openCatalog(DATA_DIR);
      try {
        applyHspDetails(db, cat, details, ymd, rid);
      } finally {
        cat.close();
      }
      if (ridNeedsHsp(db, rid)) hspOnce.delete(key);
      return true;
    } catch (err) {
      hspOnce.delete(key);
      if (err.status !== 404) console.error("HSP on-request", rid, err.message);
      return false;
    } finally {
      db.close();
    }
  })();
  hspOnce.set(key, job);
  return job;
}

export async function fillRidsHsp(ymd, rids, opts = {}) {
  const unique = [...new Set((rids || []).filter(Boolean))];
  const budgetMs = Number(opts.budgetMs ?? 8_000);
  const start = Date.now();
  let i = 0;
  for (; i < unique.length; i++) {
    if (Date.now() - start > budgetMs) break;
    await fillServiceHsp(ymd, unique[i]);
  }
  return { filled: i, pending: unique.length - i };
}

const boardHspJobs = new Map();

export function ridsNeedHsp(ymd, rids) {
  const db = openDayDb(DATA_DIR, ymd);
  try {
    return [...new Set((rids || []).filter(Boolean))].filter((rid) => ridNeedsHsp(db, rid));
  } finally {
    db.close();
  }
}

export function startBoardHspFill(ymd, rids) {
  const existing = boardHspJobs.get(ymd);
  if (existing) return existing;
  const job = fillRidsHsp(ymd, rids, { budgetMs: 180_000 }).finally(() => {
    if (boardHspJobs.get(ymd) === job) boardHspJobs.delete(ymd);
  });
  boardHspJobs.set(ymd, job);
  return job;
}
