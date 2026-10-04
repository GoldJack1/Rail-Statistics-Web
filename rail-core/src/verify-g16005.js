#!/usr/bin/env node
import "./load-env.js";
import { openDayDb, operatingDayYmd } from "./db.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const ymd = process.argv[2] || operatingDayYmd();
const db = openDayDb(DATA_DIR, ymd);

const ghosts = ["MIRFILD", "SWRBBDG", "WHTRSE"];
const interest = ["HOLBJCN", "WHRDJN", "COTNGLY", "MIRFILD", "SWRBBDG", "HETNLJN", "HDRSFLD", "BRHOUSE"];

let rid =
  process.env.VERIFY_RID ||
  db
    .prepare(
      `SELECT rid FROM services
       WHERE (headcode = '1G05' COLLATE NOCASE OR headcode = 'G16005' COLLATE NOCASE OR uid LIKE '%G16005%')
         AND length(rid)=15 AND rid GLOB '[0-9]*'
       LIMIT 1`,
    )
    .get()?.rid;

if (!rid) {
  const hit = db
    .prepare(
      `SELECT s.rid, s.headcode, s.origin_name, s.destination_name
       FROM services s
       WHERE length(s.rid)=15 AND s.rid GLOB '[0-9]*'
         AND EXISTS (SELECT 1 FROM calls c WHERE c.rid=s.rid AND c.tiploc='WHRDJN')
         AND EXISTS (SELECT 1 FROM calls c WHERE c.rid=s.rid AND c.tiploc='COTNGLY')
         AND EXISTS (SELECT 1 FROM calls c WHERE c.rid=s.rid AND c.tiploc='HDRSFLD')
       LIMIT 5`,
    )
    .all();
  console.log("candidates", hit);
  rid = hit[0]?.rid;
}

if (!rid) {
  console.error("no matching service");
  process.exit(1);
}

const svc = db.prepare(`SELECT rid, headcode, uid, origin_name, destination_name FROM services WHERE rid=?`).get(rid);
const calls = db
  .prepare(
    `SELECT tiploc, crs, is_passing, wtp, sta, std, atp, ata, atd, actual_source, leg_m, cum_m
     FROM calls WHERE rid=? ORDER BY seq`,
  )
  .all(rid);

const tipocs = calls.map((c) => c.tiploc);
const ghostHits = ghosts.filter((g) => tipocs.includes(g));
const holbeck = tipocs.includes("HOLBJCN");
const mileRows = calls.filter((c) => c.leg_m != null).slice(0, 12);
const interestPresent = interest.filter((t) => tipocs.includes(t));

console.log(
  JSON.stringify(
    {
      ymd,
      svc,
      callCount: calls.length,
      interestPresent,
      holbeck,
      ghostHits,
      samplePath: tipocs.filter((t) => interest.includes(t) || ghosts.includes(t)),
      firstMiles: mileRows.map((c) => ({
        tiploc: c.tiploc,
        leg_m: c.leg_m,
        cum_m: c.cum_m,
        legMiles: c.leg_m != null ? Math.round((c.leg_m / 1609.344) * 100) / 100 : null,
      })),
      milesCoverage: {
        withLeg: calls.filter((c) => c.leg_m != null).length,
        total: calls.length,
      },
    },
    null,
    2,
  ),
);
db.close();
