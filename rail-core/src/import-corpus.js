#!/usr/bin/env node
/** Import CORPUS CSV (STANOX,TIPLOC,CRS,NAME) into catalog.sqlite */
import { readFileSync } from "node:fs";
import { openCatalog } from "./db.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-corpus.js corpus.csv");
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const cat = openCatalog(DATA_DIR);
const lines = readFileSync(file, "utf8").split(/\r?\n/);
let n = 0;
for (const line of lines) {
  if (!line.trim() || /^stanox/i.test(line)) continue;
  const parts = line.split(/[,;\t]/).map((s) => s.replace(/^"|"$/g, "").trim());
  const [stanox, tiploc, crs, name] = parts;
  if (!stanox) continue;
  cat.prepare(
    `INSERT INTO corpus (stanox, tiploc, crs, name) VALUES (?, ?, ?, ?)
     ON CONFLICT(stanox) DO UPDATE SET tiploc=excluded.tiploc, crs=excluded.crs, name=excluded.name`
  ).run(stanox, tiploc || null, crs ? crs.toUpperCase() : null, name || null);
  if (tiploc) {
    cat.prepare(
      `INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)
       ON CONFLICT(tiploc) DO UPDATE SET crs=COALESCE(excluded.crs, tiploc.crs), name=COALESCE(excluded.name, tiploc.name)`
    ).run(tiploc, crs ? crs.toUpperCase() : null, name || null);
  }
  n++;
}
console.log("corpus rows", n);
cat.close();
