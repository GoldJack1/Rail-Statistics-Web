#!/usr/bin/env node
/** Import Network Rail CORPUS (JSON TIPLOCDATA, .json.gz, or CSV) into catalog.sqlite. */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { openCatalog } from "./db.js";

export function corpusDisplayName(raw, tiploc) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const tpl = String(tiploc || "").trim().toUpperCase();
  let text = s;
  if (text === text.toUpperCase() && /[A-Z]/.test(text)) {
    text = text
      .toLowerCase()
      .replace(/\b[a-z]/g, (ch) => ch.toUpperCase())
      .replace(/\bJn\b/g, "Junction")
      .replace(/\bJcn\b/g, "Junction")
      .replace(/\bJnct\b/g, "Junction")
      .replace(/\bLc\b/g, "Level Crossing")
      .replace(/\bSb\b/g, "Signal Box");
  }
  if (tpl && text.toUpperCase().replace(/[^A-Z0-9]/g, "") === tpl.replace(/[^A-Z0-9]/g, "")) {
    return text;
  }
  return text;
}

export function parseCorpusPayload(buf) {
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    raw = gunzipSync(raw);
  }
  const text = raw.toString("utf8").trim();
  if (/<(?:[\w]+:)?TSDBDataItem\b/i.test(text) && /<(?:[\w]+:)?NLCTiplocCode\b/i.test(text)) {
    return parseNlcXml(text);
  }
  if (text.startsWith("{") || text.startsWith("[")) {
    const json = JSON.parse(text);
    const rows = Array.isArray(json) ? json : json.TIPLOCDATA || json.tiplocData || [];
    return rows
      .map((row) => {
        const tiploc = String(row.TIPLOC || row.tiploc || "").trim().toUpperCase();
        const stanox = String(row.STANOX || row.stanox || "").trim();
        const crsRaw = String(row["3ALPHA"] || row.CRS || row.crs || "").trim().toUpperCase();
        const crs = /^[A-Z]{3}$/.test(crsRaw) ? crsRaw : null;
        const name = corpusDisplayName(row.NLCDESC || row.NLCDESC16 || row.STANME || row.name, tiploc);
        return { stanox: stanox || null, tiploc, crs, name };
      })
      .filter((r) => r.tiploc);
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^(stanox|tiploc)/i.test(line)) continue;
    const parts = line.split(/[,;\t]/).map((s) => s.replace(/^"|"$/g, "").trim());
    const [stanox, tiplocRaw, crsRaw, nameRaw] = parts;
    const tiploc = String(tiplocRaw || "").trim().toUpperCase();
    if (!tiploc) continue;
    const crs = /^[A-Z]{3}$/.test(String(crsRaw || "").toUpperCase()) ? String(crsRaw).toUpperCase() : null;
    out.push({
      stanox: stanox || null,
      tiploc,
      crs,
      name: corpusDisplayName(nameRaw, tiploc),
    });
  }
  return out;
}

function tagText(block, localName) {
  const re = new RegExp(`<(?:[\\w]+:)?${localName}>([\\s\\S]*?)</(?:[\\w]+:)?${localName}>`, "i");
  const m = re.exec(block);
  if (!m) return "";
  return m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim();
}

export function parseNlcXml(xml) {
  const out = [];
  const itemRe = /<(?:[\w]+:)?TSDBDataItem\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?TSDBDataItem>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const tiploc = tagText(block, "NLCTiplocCode").toUpperCase();
    if (!tiploc) continue;
    const crsRaw = tagText(block, "NLCCrsCode").toUpperCase();
    const crs = /^[A-Z]{3}$/.test(crsRaw) ? crsRaw : null;
    const stanox = tagText(block, "NLCStanoxCode");
    const desc = tagText(block, "NLCDescription") || tagText(block, "NLCCapriDesc");
    out.push({
      stanox: stanox || null,
      tiploc,
      crs,
      name: corpusDisplayName(desc, tiploc),
    });
  }
  return out;
}

export function parseTopsCsv(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const stanox = line.slice(0, comma).trim();
    const name = line.slice(comma + 1).trim();
    if (!/^\d{4,6}$/.test(stanox) || !name || /^stanox$/i.test(stanox)) continue;
    out.push({ stanox: stanox.padStart(5, "0"), name: corpusDisplayName(name, null) });
  }
  return out;
}

export function importTopsByStanox(cat, rows) {
  const fill = cat.prepare(
    `UPDATE corpus SET name = ?
     WHERE stanox = ? AND (name IS NULL OR trim(name) = '' OR UPPER(replace(name,' ','')) = tiploc)`,
  );
  let n = 0;
  cat.exec("BEGIN");
  for (const row of rows) {
    const r = fill.run(row.name, row.stanox);
    n += Number(r.changes || 0);
  }
  cat.exec("COMMIT");
  return n;
}

export function importCorpusRows(cat, rows) {
  const insCorpus = cat.prepare(
    `INSERT INTO corpus (tiploc, stanox, crs, name) VALUES (?, ?, ?, ?)
     ON CONFLICT(tiploc) DO UPDATE SET
       stanox=COALESCE(excluded.stanox, corpus.stanox),
       crs=COALESCE(excluded.crs, corpus.crs),
       name=CASE
         WHEN excluded.crs IS NOT NULL AND excluded.name IS NOT NULL THEN excluded.name
         WHEN corpus.crs IS NOT NULL THEN corpus.name
         WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name
         ELSE corpus.name
       END`,
  );
  const insTiploc = cat.prepare(
    `INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)
     ON CONFLICT(tiploc) DO UPDATE SET
       crs=COALESCE(excluded.crs, tiploc.crs),
       name=CASE
         WHEN excluded.crs IS NOT NULL AND excluded.name IS NOT NULL THEN excluded.name
         WHEN tiploc.crs IS NOT NULL THEN tiploc.name
         WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name
         ELSE tiploc.name
       END`,
  );
  let n = 0;
  cat.exec("BEGIN");
  for (const row of rows) {
    if (!row.tiploc) continue;
    insCorpus.run(row.tiploc, row.stanox, row.crs, row.name);
    insTiploc.run(row.tiploc, row.crs, row.name);
    n += 1;
  }
  cat.exec("COMMIT");
  return n;
}

const runningAsCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/import-corpus.js");
if (runningAsCli) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node src/import-corpus.js NLC.xml[.gz]|corpus.json[.gz]|corpus.csv");
    process.exit(1);
  }
  const DATA_DIR = process.env.DATA_DIR ?? "./data";
  const cat = openCatalog(DATA_DIR);
  const n = importCorpusRows(cat, parseCorpusPayload(readFileSync(file)));
  console.log("corpus rows", n);
  cat.close();
}
