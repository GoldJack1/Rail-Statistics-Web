#!/usr/bin/env node
/**
 * Import a Darwin PPTimetable v8 XML (.xml or .xml.gz) into today's day sqlite.
 */
import { createReadStream, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { basename } from "node:path";
import { openCatalog, openDayDb, operatingDayYmd, refreshServiceJourney } from "./db.js";
import { applyParsed, parseDarwinPportXml } from "./darwin-xml.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-pptimetable.js <PPTimetable_v8.xml[.gz]> [YYYY-MM-DD]");
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

const ymd = process.argv[3] || operatingDayYmd();
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const xml = await readXml(file);
const journeys = xml.match(/<(?:ns\d*:)?Journey\b[\s\S]*?<\/(?:ns\d*:)?Journey>/gi) || [];
console.log(basename(file), "journeys", journeys.length, "day", ymd);
const db = openDayDb(DATA_DIR, ymd);
const catalog = openCatalog(DATA_DIR);
const nameLookup = (crs, tpl) => {
  if (crs) {
    const byCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`).get(crs);
    if (byCrs?.name) return byCrs.name;
  }
  if (tpl) {
    const byTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`).get(String(tpl).toUpperCase());
    if (byTpl?.name) return byTpl.name;
  }
  return null;
};
let n = 0;
db.exec("BEGIN");
for (const j of journeys) {
  const parsed = parseDarwinPportXml(`<Pport>${j}</Pport>`);
  if (!parsed) continue;
  applyParsed(db, parsed);
  refreshServiceJourney(db, parsed.service.rid, nameLookup);
  n++;
  if (n % 2000 === 0) {
    db.exec("COMMIT");
    db.exec("BEGIN");
    console.log("imported", n);
  }
}
db.exec("COMMIT");
db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('timetable_imported', ?)`).run(ymd);
console.log("imported", n, "timetable journeys");
db.close();
catalog.close();
