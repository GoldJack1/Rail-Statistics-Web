#!/usr/bin/env node
/**
 * Import Network Rail SMART berth steps into catalog.sqlite.
 * Join STANOX → TIPLOC via CORPUS at lookup time (td-apply / resolveSmartTiploc).
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openCatalog } from "./db.js";

export function ensureSmartTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_steps (
      td_area TEXT NOT NULL,
      from_berth TEXT NOT NULL DEFAULT '',
      to_berth TEXT NOT NULL DEFAULT '',
      stanox TEXT,
      event_type TEXT,
      platform TEXT,
      from_line TEXT,
      to_line TEXT,
      route TEXT,
      berth_offset TEXT,
      PRIMARY KEY (td_area, from_berth, to_berth, event_type, stanox)
    );
    CREATE INDEX IF NOT EXISTS idx_smart_to ON smart_steps (td_area, to_berth);
    CREATE INDEX IF NOT EXISTS idx_smart_from ON smart_steps (td_area, from_berth);
    CREATE INDEX IF NOT EXISTS idx_smart_stanox ON smart_steps (stanox);
  `);
}

function asStr(v) {
  if (v == null) return "";
  return String(v).trim();
}

function normalizeStanox(v) {
  const s = asStr(v).replace(/\D/g, "");
  if (!s) return null;
  return s.padStart(5, "0").slice(-5);
}

/**
 * Accept SMART JSON (array, {SMART:[…]}, gzip bytes, or Buffer).
 * @returns {Array<object>}
 */
export function parseSmartPayload(raw) {
  let buf = raw;
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
      buf = gunzipSync(raw);
    }
    buf = Buffer.from(buf).toString("utf8");
  }
  const text = String(buf || "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.SMART)
      ? parsed.SMART
      : Array.isArray(parsed?.BERTHDATA)
        ? parsed.BERTHDATA
        : Array.isArray(parsed?.smart)
          ? parsed.smart
          : [];
  return list.filter((row) => row && typeof row === "object");
}

export function normalizeSmartRow(row) {
  const td = asStr(row.TD || row.td || row.td_area || row.area).toUpperCase();
  const toBerth = asStr(row.TOBERTH || row.to_berth || row.to || row.TO).toUpperCase();
  const fromBerth = asStr(row.FROMBERTH || row.from_berth || row.from || row.FROM).toUpperCase();
  if (!td || (!toBerth && !fromBerth)) return null;
  return {
    td_area: td,
    from_berth: fromBerth,
    to_berth: toBerth,
    stanox: normalizeStanox(row.STANOX || row.stanox || row.loc_stanox),
    event_type: asStr(row.EVENT || row.event || row.event_type || "").toUpperCase() || null,
    platform: asStr(row.PLATFORM || row.platform) || null,
    from_line: asStr(row.FROMLINE || row.from_line) || null,
    to_line: asStr(row.TOLINE || row.to_line) || null,
    route: asStr(row.ROUTE || row.route) || null,
    berth_offset: asStr(row.BERTHOFFSET || row.OFFSET || row.berth_offset) || null,
  };
}

export function importSmartPayload(db, rows) {
  ensureSmartTables(db);
  const list = (rows || []).map(normalizeSmartRow).filter(Boolean);
  db.exec("BEGIN");
  db.exec("DELETE FROM smart_steps");
  const ins = db.prepare(
    `INSERT OR IGNORE INTO smart_steps
      (td_area, from_berth, to_berth, stanox, event_type, platform, from_line, to_line, route, berth_offset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let n = 0;
  for (const r of list) {
    const info = ins.run(
      r.td_area,
      r.from_berth,
      r.to_berth,
      r.stanox,
      r.event_type,
      r.platform,
      r.from_line,
      r.to_line,
      r.route,
      r.berth_offset,
    );
    if (info.changes) n++;
  }
  db.exec("COMMIT");
  return n;
}

/**
 * Resolve TD area+berth → TIPLOC via SMART STANOX + CORPUS.
 * Prefers to_berth match, then from_berth.
 */
export function resolveSmartTiploc(catalog, areaId, berth, fromBerth = null) {
  ensureSmartTables(catalog);
  const area = asStr(areaId).toUpperCase();
  const to = asStr(berth).toUpperCase();
  const from = asStr(fromBerth).toUpperCase();
  if (!area || (!to && !from)) return null;

  const step =
    (to &&
      catalog
        .prepare(
          `SELECT stanox, event_type, platform FROM smart_steps
           WHERE td_area = ? AND to_berth = ? AND stanox IS NOT NULL
           ORDER BY CASE event_type WHEN 'C' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END
           LIMIT 1`,
        )
        .get(area, to)) ||
    (from &&
      catalog
        .prepare(
          `SELECT stanox, event_type, platform FROM smart_steps
           WHERE td_area = ? AND from_berth = ? AND stanox IS NOT NULL
           ORDER BY CASE event_type WHEN 'C' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END
           LIMIT 1`,
        )
        .get(area, from)) ||
    null;
  if (!step?.stanox) return null;
  const corpus = catalog
    .prepare(`SELECT tiploc, crs, name FROM corpus WHERE stanox = ? LIMIT 1`)
    .get(step.stanox);
  if (!corpus?.tiploc) return null;
  return {
    tiploc: String(corpus.tiploc).toUpperCase(),
    crs: corpus.crs || null,
    name: corpus.name || null,
    stanox: step.stanox,
    eventType: step.event_type || null,
    platform: step.platform || null,
  };
}

const runningAsCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/import-smart.js");
if (runningAsCli) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node src/import-smart.js smart.json[.gz]");
    process.exit(1);
  }
  const DATA_DIR = process.env.DATA_DIR ?? "./data";
  const cat = openCatalog(DATA_DIR);
  const n = importSmartPayload(cat, parseSmartPayload(readFileSync(path)));
  cat.close();
  console.log("smart steps", n);
}
