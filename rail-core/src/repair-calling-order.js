#!/usr/bin/env node
/**
 * One-shot: merge leftover CIF uid stubs onto Darwin 15-digit RIDs,
 * drop dummy 00:00 public times, and refresh origin/destination.
 * Usage: node src/repair-calling-order.js [YYYY-MM-DD]
 */
import { readdirSync } from "node:fs";
import { adoptUidOntoRid, openCatalog, openDayDb, operatingDayYmd, refreshServiceJourney } from "./db.js";
import { publicCallTime } from "./journey-order.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const start = process.argv[2] || operatingDayYmd();
const catalog = openCatalog(DATA_DIR);
const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
const stationName = (crs, tpl) =>
  (crs && nameByCrs.get(crs)?.name) || (tpl && nameByTpl.get(String(tpl).toUpperCase())?.name) || null;

const days = readdirSync(DATA_DIR)
  .map((n) => n.match(/^day-(\d{4}-\d{2}-\d{2})\.sqlite$/)?.[1])
  .filter((ymd) => ymd && ymd >= start)
  .sort();

for (const ymd of days) {
  const db = openDayDb(DATA_DIR, ymd);
  db.exec("BEGIN");
  const uids = db.prepare(`SELECT DISTINCT uid FROM services WHERE uid IS NOT NULL AND uid != ''`).all();
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
  const calls = db.prepare(`SELECT rid, tiploc, sta, std, wta, wtd, wtp, is_passing FROM calls`).all();
  const upd = db.prepare(
    `UPDATE calls SET sta=@sta, std=@std, is_passing=@is_passing WHERE rid=@rid AND tiploc=@tiploc`,
  );
  let dummy = 0;
  for (const c of calls) {
    const sta = publicCallTime(c.sta, c);
    const std = publicCallTime(c.std, c);
    let passing = Number(c.is_passing) ? 1 : 0;
    if (!passing && c.wtp && !sta && !std && !c.wta && !c.wtd) passing = 1;
    if (sta === c.sta && std === c.std && passing === Number(c.is_passing)) continue;
    dummy += 1;
    upd.run({ rid: c.rid, tiploc: c.tiploc, sta, std, is_passing: passing });
  }
  const rids = db.prepare(`SELECT rid FROM services`).all();
  for (const row of rids) refreshServiceJourney(db, row.rid, stationName);
  db.exec("COMMIT");
  console.log(`${ymd} adopted=${adopted} dummy_calls=${dummy} services=${rids.length}`);
  db.close();
}
catalog.close();
