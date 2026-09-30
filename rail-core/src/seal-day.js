#!/usr/bin/env node
/**
 * Close-of-day HSP merge: fill missing public stop actuals; keep Darwin pass times.
 * Usage: node src/seal-day.js 2026-09-29
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hhmm, liveKind, openDayDb } from "./db.js";

const ymd = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? "")) {
  console.error("usage: node src/seal-day.js YYYY-MM-DD");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const HSP_ORIGIN = process.env.NRDP_HSP_ORIGIN ?? "https://hsp-prod.rockshore.net";
const user = process.env.NRDP_HSP_USER ?? "";
const pass = process.env.NRDP_HSP_PASSWORD ?? "";

function applyMetrics(db, metrics) {
  const services = metrics?.Services ?? metrics?.services ?? [];
  let filled = 0;
  for (const svc of services) {
    const rid = svc.rid ?? svc.RID ?? svc.serviceAttributesMetrics?.rid;
    const locs = svc.Locations ?? svc.locations ?? svc.serviceAttributesMetrics?.locations ?? [];
    if (!rid) continue;
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i];
      const crs = loc.crs ?? loc.location ?? loc.station;
      const ata = hhmm(loc.actual_ta ?? loc.ata);
      const atd = hhmm(loc.actual_td ?? loc.atd);
      if (!crs || (!ata && !atd)) continue;
      const existing = db
        .prepare(`SELECT ata, atd, atp, is_passing FROM calls WHERE rid = ? AND crs = ?`)
        .get(rid, crs);
      if (!existing || existing.is_passing) continue;
      if (existing.ata || existing.atd) continue;
      const live_kind = liveKind({ ata, atd, atp: existing.atp });
      db.prepare(
        `UPDATE calls SET ata = COALESCE(ata, ?), atd = COALESCE(atd, ?), live_kind = ?, actual_source = COALESCE(actual_source, 'hsp'), updated_at = ?
         WHERE rid = ? AND crs = ? AND is_passing = 0`
      ).run(ata, atd, live_kind, Date.now(), rid, crs);
      filled++;
    }
  }
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', ?)`).run(new Date().toISOString());
  const cacheDir = join(DATA_DIR, "hsp", ymd);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "metrics.json"), JSON.stringify(metrics));
  return filled;
}

const db = openDayDb(DATA_DIR, ymd);
if (!user || !pass) {
  const sample = process.env.HSP_SAMPLE_JSON;
  if (sample) {
    const n = applyMetrics(db, JSON.parse(readFileSync(sample, "utf8")));
    console.log(`sealed ${ymd} from sample, filled ${n}`);
    db.close();
    process.exit(0);
  }
  console.error("NRDP_HSP_USER/PASSWORD not set; wrote sealed=false");
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('sealed', 'skipped-no-hsp')`).run();
  db.close();
  process.exit(0);
}

const auth = Buffer.from(`${user}:${pass}`).toString("base64");
const res = await fetch(`${HSP_ORIGIN}/api/v1/serviceMetrics`, {
  method: "POST",
  headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
  body: JSON.stringify({
    from_loc: "PAD",
    to_loc: "PAD",
    from_time: "0000",
    to_time: "2359",
    from_date: ymd,
    to_date: ymd,
    days: "WEEKDAY",
  }),
});
if (!res.ok) {
  console.error("HSP metrics failed", res.status, await res.text());
  process.exit(1);
}
const metrics = await res.json();
const n = applyMetrics(db, metrics);
console.log(`sealed ${ymd}, filled ${n} stop actuals from HSP`);
db.close();
