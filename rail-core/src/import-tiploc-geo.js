#!/usr/bin/env node
/**
 * Import TIPLOC coordinates into catalog.tiploc_geo.
 *
 * Primary: tt/ref/tiplocs-merged.csv (YA TIPLOC list — OGL/CC sources, junctions + stations)
 * Gap-fill: tt/ref/RailReferences.csv (NaPTAN RailReferences via Huxley)
 *
 * Usage: node src/import-tiploc-geo.js [path.csv ...]
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openCatalog } from "./db.js";
import { osgbToWgs84 } from "./osgb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
const DEFAULT_PATHS = [
  join(ROOT, "tt/ref/tiplocs-merged.csv"),
  join(ROOT, "tt/ref/RailReferences.csv"),
];

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (cells[j] ?? "").replace(/^"|"$/g, "").trim();
    }
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function tipFromStopId(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("9100") && s.length > 4) return s.slice(4);
  if (s.startsWith("910G") && s.length > 4) return s.slice(4);
  return s;
}

function num(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Normalize one CSV row into { tiploc, easting, northing, lat, lon, source }. */
export function rowToGeo(row, defaultSource = "csv") {
  if (!row || typeof row !== "object") return null;
  const tiploc =
    tipFromStopId(row.stop_id) ||
    tipFromStopId(row.TIPLOC) ||
    tipFromStopId(row.TiplocCode) ||
    tipFromStopId(row.tiploc);
  if (!tiploc || tiploc.length > 10) return null;

  let lat = num(row.stop_lat ?? row.lat ?? row.Latitude);
  let lon = num(row.stop_lon ?? row.lon ?? row.Longitude);
  const easting = num(row.easting ?? row.Easting);
  const northing = num(row.northing ?? row.Northing);

  if ((lat == null || lon == null) && easting != null && northing != null) {
    const wgs = osgbToWgs84(easting, northing);
    if (wgs) {
      lat = wgs.lat;
      lon = wgs.lon;
    }
  }
  if (lat == null || lon == null) return null;
  if (lat < 49 || lat > 61 || lon < -9 || lon > 2) return null;

  return {
    tiploc,
    easting,
    northing,
    lat,
    lon,
    source: String(row.stop_url || row.dataSource || row.Modification || defaultSource).slice(0, 40),
  };
}

export function parseGeoFile(text, defaultSource = "csv") {
  const rows = parseCsv(text);
  const out = [];
  for (const row of rows) {
    const g = rowToGeo(row, defaultSource);
    if (g) out.push(g);
  }
  return out;
}

export function importTiplocGeoFiles(dataDir, paths) {
  const catalog = openCatalog(dataDir);
  catalog.exec(`
    CREATE TABLE IF NOT EXISTS tiploc_geo (
      tiploc TEXT PRIMARY KEY,
      easting REAL,
      northing REAL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      source TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tiploc_geo_latlon ON tiploc_geo (lat, lon);
  `);

  const byTpl = new Map();
  let files = 0;
  for (const path of paths) {
    if (!existsSync(path)) {
      console.warn("skip missing", path);
      continue;
    }
    files++;
    const text = readFileSync(path, "utf8");
    const source = path.includes("RailReferences") ? "naptan" : "tiplocs-merged";
    for (const g of parseGeoFile(text, source)) {
      // Prefer first/higher-quality file; allow naptan to fill gaps only.
      if (source === "naptan" && byTpl.has(g.tiploc)) continue;
      if (source !== "naptan" || !byTpl.has(g.tiploc)) byTpl.set(g.tiploc, g);
    }
  }

  catalog.exec("BEGIN");
  catalog.exec("DELETE FROM tiploc_geo");
  const ins = catalog.prepare(
    `INSERT INTO tiploc_geo (tiploc, easting, northing, lat, lon, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const g of byTpl.values()) {
    ins.run(g.tiploc, g.easting, g.northing, g.lat, g.lon, g.source);
  }
  catalog.exec("COMMIT");
  const n = catalog.prepare(`SELECT COUNT(*) AS n FROM tiploc_geo`).get().n;
  catalog.close();
  return { files, tipocs: n };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PATHS;
  const out = importTiplocGeoFiles(DATA_DIR, paths);
  console.log(`import-tiploc-geo files=${out.files} tipocs=${out.tipocs}`);
}
