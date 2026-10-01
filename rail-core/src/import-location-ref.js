#!/usr/bin/env node
/** Import Darwin LocationRef (tpl, crs, locname) from a PPTimetable *_ref_*.xml[.gz]. */
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { basename } from "node:path";
import { openCatalog } from "./db.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-location-ref.js <ref.xml[.gz]>");
  process.exit(1);
}

async function readXml(path) {
  if (/\.gz$/i.test(path)) {
    const chunks = [];
    const stream = createReadStream(path).pipe(createGunzip());
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFileSync(path, "utf8");
}

const xml = await readXml(file);
const locRe = /<LocationRef\s+([^>]*?)\/>/g;
const attrRe = /(\w+)="([^"]*)"/g;
const catalog = openCatalog(process.env.DATA_DIR ?? "./data");
const ins = catalog.prepare(
  `INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)
   ON CONFLICT(tiploc) DO UPDATE SET
     crs=COALESCE(excluded.crs, tiploc.crs),
     name=COALESCE(excluded.name, tiploc.name)`,
);
let n = 0;
catalog.exec("BEGIN");
let m;
while ((m = locRe.exec(xml))) {
  const attrs = {};
  let a;
  attrRe.lastIndex = 0;
  while ((a = attrRe.exec(m[1]))) attrs[a[1]] = a[2];
  const tpl = String(attrs.tpl || "").trim().toUpperCase();
  if (!tpl) continue;
  const crs = attrs.crs ? String(attrs.crs).trim().toUpperCase() : null;
  const rawName = attrs.locname ? String(attrs.locname).replace(/&amp;/g, "&").trim() : "";
  const name = rawName && rawName.toUpperCase() !== tpl ? rawName : null;
  ins.run(tpl, crs, name);
  n++;
}
catalog.exec("COMMIT");
console.log(basename(file), "location refs", n);
catalog.close();
