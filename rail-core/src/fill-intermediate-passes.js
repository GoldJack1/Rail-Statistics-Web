#!/usr/bin/env node
/**
 * Fill Darwin calling patterns with ITPS-derived intermediate working passes.
 * Usage: node src/fill-intermediate-passes.js [YYYY-MM-DD]
 */
import "./load-env.js";
import { pathToFileURL } from "node:url";
import {
  openCatalog,
  openDayDb,
  operatingDayYmd,
  refreshServiceJourney,
  restoreCallLive,
  snapshotCallLive,
  upsertCall,
} from "./db.js";
import {
  DEFAULT_MIN_EDGE,
  fillCallsWithGraph,
  loadAdjFromCatalog,
  loadStationTiplocsFromCatalog,
} from "./tiploc-graph.js";

const ymd = process.argv[2] || operatingDayYmd();
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const minEdge = Math.max(5, Number(process.env.TT_GRAPH_MIN_EDGE ?? DEFAULT_MIN_EDGE) || DEFAULT_MIN_EDGE);

export function fillIntermediatePassesForDay(dataDir, dayYmd, { minEdge: floor = minEdge } = {}) {
  const adj = loadAdjFromCatalog(dataDir, { minEdge: floor });
  if (!adj.size) return { services: 0, inserted: 0, edges: 0 };
  const stationMids = loadStationTiplocsFromCatalog(dataDir);

  const catalog = openCatalog(dataDir);
  const crsStmt = catalog.prepare(`SELECT crs FROM tiploc WHERE tiploc = ?`);
  const nameByCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`);
  const nameByTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`);
  const resolveCrs = (tpl) => crsStmt.get(String(tpl).toUpperCase())?.crs || null;
  const resolveName = (crs, tpl) =>
    (crs && nameByCrs.get(crs)?.name) ||
    (tpl && nameByTpl.get(String(tpl).toUpperCase())?.name) ||
    null;

  const db = openDayDb(dataDir, dayYmd);
  db.exec("PRAGMA busy_timeout=120000");
  const svcs = db
    .prepare(
      `SELECT rid FROM services
       WHERE length(rid)=15 AND rid GLOB '[0-9]*'`,
    )
    .all();
  const locStmt = db.prepare(`SELECT * FROM calls WHERE rid = ? ORDER BY seq`);
  const delCalls = db.prepare(`DELETE FROM calls WHERE rid = ?`);

  let services = 0;
  let inserted = 0;
  db.exec("BEGIN");
  for (const svc of svcs) {
    const before = locStmt.all(svc.rid);
    if (before.length < 2) continue;
    const { calls: filled, inserted: n } = fillCallsWithGraph(before, adj, { stationMids });
    if (!n) continue;
    const live = snapshotCallLive(db, svc.rid);
    delCalls.run(svc.rid);
    for (const row of filled) {
      const payload = row.graphPass
        ? {
            rid: svc.rid,
            tiploc: row.tiploc,
            crs: resolveCrs(row.tiploc),
            seq: row.seq,
            is_passing: 1,
            cancelled: 0,
            platform: null,
            length_cars: null,
            formation: null,
            sta: null,
            std: null,
            wta: null,
            wtd: null,
            wtp: row.wtp,
            ata: null,
            atd: null,
            atp: null,
            eta: null,
            etd: null,
            etp: null,
            delay_minutes: null,
            status: null,
            live_kind: "scheduled",
            actual_source: null,
            updated_at: Date.now(),
          }
        : { ...row, rid: svc.rid, seq: row.seq };
      delete payload.graphPass;
      upsertCall(db, payload);
    }
    if (live.length) restoreCallLive(db, svc.rid, live);
    refreshServiceJourney(db, svc.rid, resolveName);
    services++;
    inserted += n;
  }
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('graph_fill_at', ?)`).run(
    new Date().toISOString(),
  );
  db.exec("COMMIT");
  db.close();
  catalog.close();
  return { services, inserted, edges: adj.size };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const out = fillIntermediatePassesForDay(DATA_DIR, ymd);
  console.log(
    `fill-intermediate-passes ${ymd} services=${out.services} inserted=${out.inserted} edgeNodes=${out.edges}`,
  );
}
