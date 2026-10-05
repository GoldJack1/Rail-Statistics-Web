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

/** TD berths: pad numeric ids to 4 chars (0401); leave alpha berths as-is (HOLB). */
export function normalizeBerth(raw) {
  const s = asStr(raw).toUpperCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s.padStart(4, "0");
  return s;
}

const EVENT_RANK = `CASE event_type WHEN 'C' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'D' THEN 3 ELSE 4 END`;

function lookupCorpusByStanox(catalog, stanox) {
  const s = normalizeStanox(stanox);
  if (!s) return null;
  let row = catalog.prepare(`SELECT tiploc, crs, name FROM corpus WHERE stanox = ? LIMIT 1`).get(s);
  if (!row && /^0/.test(s)) {
    row = catalog
      .prepare(`SELECT tiploc, crs, name FROM corpus WHERE stanox = ? LIMIT 1`)
      .get(String(Number(s)));
  }
  return row?.tiploc
    ? { tiploc: String(row.tiploc).toUpperCase(), crs: row.crs || null, name: row.name || null, stanox: s }
    : null;
}

function pickSmartStep(catalog, rows, hintTiplocs = null) {
  if (!rows?.length) return null;
  if (hintTiplocs?.size) {
    for (const row of rows) {
      const corpus = lookupCorpusByStanox(catalog, row.stanox);
      if (corpus?.tiploc && hintTiplocs.has(corpus.tiploc)) return { ...row, corpus };
    }
  }
  const corpus = lookupCorpusByStanox(catalog, rows[0].stanox);
  if (!corpus) return null;
  return { ...rows[0], corpus };
}

function querySmartSteps(catalog, area, from, to) {
  if (from && to) {
    const pair = catalog
      .prepare(
        `SELECT stanox, event_type, platform FROM smart_steps
         WHERE td_area = ? AND from_berth = ? AND to_berth = ? AND stanox IS NOT NULL
         ORDER BY ${EVENT_RANK}`,
      )
      .all(area, from, to);
    if (pair.length) return pair;
  }
  if (to) {
    const hit = catalog
      .prepare(
        `SELECT stanox, event_type, platform FROM smart_steps
         WHERE td_area = ? AND to_berth = ? AND stanox IS NOT NULL
         ORDER BY ${EVENT_RANK}`,
      )
      .all(area, to);
    if (hit.length) return hit;
    if (/^0/.test(to)) {
      const unpadded = String(Number(to));
      if (unpadded !== to) {
        return catalog
          .prepare(
            `SELECT stanox, event_type, platform FROM smart_steps
             WHERE td_area = ? AND to_berth = ? AND stanox IS NOT NULL
             ORDER BY ${EVENT_RANK}`,
          )
          .all(area, unpadded);
      }
    }
  }
  if (from) {
    return catalog
      .prepare(
        `SELECT stanox, event_type, platform FROM smart_steps
         WHERE td_area = ? AND from_berth = ? AND stanox IS NOT NULL
         ORDER BY ${EVENT_RANK}`,
      )
      .all(area, from);
  }
  return [];
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
  const toBerth = normalizeBerth(row.TOBERTH || row.to_berth || row.to || row.TO);
  const fromBerth = normalizeBerth(row.FROMBERTH || row.from_berth || row.from || row.FROM);
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
 * Prefers (from→to) CA step, then to_berth, then from_berth.
 * @param {Set<string>|null} [opts.hintTiplocs] service spine tipocs for disambiguation
 */
export function resolveSmartTiploc(catalog, areaId, berth, fromBerth = null, opts = {}) {
  ensureSmartTables(catalog);
  const area = asStr(areaId).toUpperCase();
  const to = normalizeBerth(berth);
  const from = normalizeBerth(fromBerth);
  if (!area || (!to && !from)) return null;

  const hintTiplocs = opts.hintTiplocs || null;
  const hit = pickSmartStep(catalog, querySmartSteps(catalog, area, from, to), hintTiplocs);
  if (!hit?.corpus) return null;
  return {
    tiploc: hit.corpus.tiploc,
    crs: hit.corpus.crs,
    name: hit.corpus.name,
    stanox: hit.corpus.stanox,
    eventType: hit.event_type || null,
    platform: hit.platform || null,
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
