#!/usr/bin/env node
/** Load {tiploc,crs,name} JSON into catalog.sqlite */
import { readFileSync } from "node:fs";
import { openCatalog } from "./db.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-crs-map.js tiploc-crs.json");
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const rows = JSON.parse(readFileSync(file, "utf8"));
const cat = openCatalog(DATA_DIR);
const ins = cat.prepare(
  `INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)
   ON CONFLICT(tiploc) DO UPDATE SET crs=COALESCE(excluded.crs, tiploc.crs), name=COALESCE(excluded.name, tiploc.name)`
);
let n = 0;
for (const row of rows) {
  const tpl = String(row.tiploc || "").trim().toUpperCase();
  const crs = String(row.crs || row.crsCode || "").trim().toUpperCase();
  if (!tpl || !/^[A-Z0-9]{3}$/.test(crs)) continue;
  ins.run(tpl, crs, row.name || row.stationName || null);
  n++;
}
console.log("tiploc rows upserted", n);
cat.close();
