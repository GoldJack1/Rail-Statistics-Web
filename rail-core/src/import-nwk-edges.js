#!/usr/bin/env node
/**
 * Import BPLAN PIF Network Link (NWK) records into catalog.nwk_edges.
 * Used by ORM graph rebuild for track-metre edges — never creates call rows.
 *
 * BPLAN PIF: tab-separated NWK lines (Open Rail Data wiki).
 * Optional: TT_BPLAN_PATH or BPLAN_PATH env, or tt/*bplan* / tt/*.pif in TT_DIR.
 */
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openCatalog } from "./db.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @typedef {{ from: string, to: string, metres: number, runningLine: string }} NwkEdge */

export function normalizeTiploc(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/**
 * Parse one NWK PIF line. Returns null for non-NWK, delete, or invalid rows.
 * @param {string} line
 * @returns {NwkEdge | null}
 */
export function parseNwkLine(line) {
  if (!line || !line.startsWith("NWK\t")) return null;
  const fields = line.split("\t");
  const action = String(fields[1] || "")
    .trim()
    .toUpperCase();
  if (action === "D") return null;
  const from = normalizeTiploc(fields[2]);
  const to = normalizeTiploc(fields[3]);
  if (!from || !to || from === to) return null;
  const runningLine = String(fields[4] || "")
    .trim()
    .toUpperCase();
  const distRaw = String(fields[10] ?? fields[9] ?? "").trim();
  const metres = Number(distRaw);
  if (!Number.isFinite(metres) || metres <= 0) return null;
  return { from, to, metres, runningLine };
}

/**
 * Parse NWK edges from a PIF file (streaming — safe for multi-MB BPLAN extracts).
 * @param {string} path
 * @returns {Promise<NwkEdge[]>}
 */
export async function parseNwkFile(path) {
  /** @type {NwkEdge[]} */
  const edges = [];
  const input = /\.gz$/i.test(path)
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const edge = parseNwkLine(line);
    if (edge) edges.push(edge);
  }
  return edges;
}

/** Collapse parallel running lines to one undirected pair (shortest metres). */
export function dedupeNwkEdges(edges) {
  /** @type {Map<string, NwkEdge>} */
  const byPair = new Map();
  for (const e of edges) {
    const a = e.from;
    const b = e.to;
    const key = a < b ? `${a}\t${b}` : `${b}\t${a}`;
    const prev = byPair.get(key);
    if (!prev || e.metres < prev.metres) {
      byPair.set(key, { ...e, from: a, to: b });
    }
  }
  return [...byPair.values()];
}

export function ensureNwkEdgesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nwk_edges (
      from_tpl TEXT NOT NULL,
      to_tpl TEXT NOT NULL,
      metres REAL NOT NULL,
      running_line TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (from_tpl, to_tpl, running_line)
    );
    CREATE INDEX IF NOT EXISTS idx_nwk_edges_from ON nwk_edges (from_tpl);
  `);
}

/**
 * Replace catalog.nwk_edges from parsed NWK rows.
 * @returns {number} rows inserted
 */
export function saveNwkEdgesToCatalog(dataDir, edges) {
  const catalog = openCatalog(dataDir);
  ensureNwkEdgesTable(catalog);
  catalog.exec("BEGIN");
  catalog.exec("DELETE FROM nwk_edges");
  const ins = catalog.prepare(
    `INSERT OR REPLACE INTO nwk_edges (from_tpl, to_tpl, metres, running_line) VALUES (?, ?, ?, ?)`,
  );
  let n = 0;
  for (const e of edges) {
    ins.run(e.from, e.to, e.metres, e.runningLine || "");
    n++;
  }
  catalog.exec("COMMIT");
  catalog.close();
  return n;
}

export function findBplanFile() {
  const env = process.env.BPLAN_PATH || process.env.TT_BPLAN_PATH;
  if (env && existsSync(env)) return env;
  const ttDir = process.env.TT_DIR ?? join(ROOT, "tt");
  if (!existsSync(ttDir)) return null;
  const link = join(ttDir, "bplan.pif");
  if (existsSync(link)) return link;
  const bplanDir = join(ttDir, "bplan");
  if (existsSync(bplanDir)) {
    const pifs = readdirSync(bplanDir)
      .filter((n) => /^PIF.*\.txt(\.gz)?$/i.test(n))
      .sort();
    if (pifs.length) return join(bplanDir, pifs[pifs.length - 1]);
  }
  const names = readdirSync(ttDir).sort();
  const hit = names.find((n) => /^bplan/i.test(n) || /\.pif$/i.test(n) || /^PIF/i.test(n));
  return hit ? join(ttDir, hit) : null;
}

/**
 * Import NWK edges from a BPLAN PIF file into catalog.
 * @returns {Promise<number>}
 */
export async function importBplanNwkEdges(path, dataDir) {
  if (!path || !existsSync(path)) return 0;
  const raw = await parseNwkFile(path);
  const edges = dedupeNwkEdges(raw);
  const n = saveNwkEdgesToCatalog(dataDir, edges);
  return n;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const path = process.argv[2] || findBplanFile();
  const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
  if (!path) {
    console.error("No BPLAN PIF — set BPLAN_PATH or place file in tt/");
    process.exit(1);
  }
  const n = await importBplanNwkEdges(path, DATA_DIR);
  console.log("imported NWK edges", n, "from", basename(path));
}
