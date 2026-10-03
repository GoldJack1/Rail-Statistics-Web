#!/usr/bin/env node
/**
 * One-shot: merge leftover CIF uid stubs onto Darwin 15-digit RIDs,
 * drop dummy 00:00 public times, and refresh origin/destination.
 * Usage: node src/repair-calling-order.js [YYYY-MM-DD] [YYYY-MM-DD-end]
 */
import "./load-env.js";
import { readdirSync } from "node:fs";
import { adoptUidOntoRid, openCatalog, openDayDb, operatingDayYmd, refreshServiceJourney } from "./db.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const start = process.argv[2] || operatingDayYmd();
const end = process.argv[3] || "9999-12-31";
const catalog = openCatalog(DATA_DIR);
const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
const stationName = (crs, tpl) =>
  (crs && nameByCrs.get(crs)?.name) || (tpl && nameByTpl.get(String(tpl).toUpperCase())?.name) || null;

const days = readdirSync(DATA_DIR)
  .map((n) => n.match(/^day-(\d{4}-\d{2}-\d{2})\.sqlite$/)?.[1])
  .filter((ymd) => ymd && ymd >= start && ymd <= end)
  .sort();

for (const ymd of days) {
  const t0 = Date.now();
  const db = openDayDb(DATA_DIR, ymd);
  db.exec("PRAGMA busy_timeout=120000");
  db.exec("BEGIN");
  const uids = db
    .prepare(
      `SELECT uid FROM services WHERE uid IS NOT NULL AND uid != '' GROUP BY uid HAVING COUNT(*) > 1`,
    )
    .all();
  let adopted = 0;
  for (const row of uids) {
    const darwin = db
      .prepare(
        `SELECT rid FROM services WHERE uid = ? COLLATE NOCASE AND length(rid)=15 AND rid GLOB '[0-9]*' LIMIT 1`,
      )
      .get(row.uid);
    if (!darwin) continue;
    const before = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE uid = ? COLLATE NOCASE`).get(row.uid).n;
    adoptUidOntoRid(db, row.uid, darwin.rid);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE uid = ? COLLATE NOCASE`).get(row.uid).n;
    if (after < before) adopted += before - after;
  }
  const dummySta = db
    .prepare(
      `UPDATE calls SET sta = NULL
       WHERE sta = '00:00' AND wtp IS NOT NULL AND substr(wtp,1,2) NOT IN ('00','01','23')`,
    )
    .run().changes;
  const dummyStd = db
    .prepare(
      `UPDATE calls SET std = NULL
       WHERE std = '00:00' AND wtp IS NOT NULL AND substr(wtp,1,2) NOT IN ('00','01','23')`,
    )
    .run().changes;
  const markedPass = db
    .prepare(
      `UPDATE calls SET is_passing = 1
       WHERE IFNULL(is_passing,0)=0 AND wtp IS NOT NULL AND sta IS NULL AND std IS NULL
         AND wta IS NULL AND wtd IS NULL`,
    )
    .run().changes;
  const rids = db.prepare(`SELECT rid FROM services`).all();
  for (const row of rids) refreshServiceJourney(db, row.rid, stationName);
  db.exec("COMMIT");
  console.log(
    `${ymd} adopted=${adopted} dummy_sta=${dummySta} dummy_std=${dummyStd} pass=${markedPass} services=${rids.length} ${Date.now() - t0}ms`,
  );
  db.close();
}
catalog.close();
