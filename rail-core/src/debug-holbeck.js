#!/usr/bin/env node
import "./load-env.js";
import { openCatalog, openDayDb, operatingDayYmd } from "./db.js";
import { loadOrmAdj, ormIntermediatePath } from "./orm-path.js";
import { loadTiplocMeta, haversineM } from "./geometry-densify.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const cat = openCatalog(DATA_DIR);
const tips = ["WHRDJN", "HOLBJCN", "COTNGLY", "HETNLJN", "MIRFILD", "SWRBBDG", "MRLY"];
const geo = cat
  .prepare(`SELECT tiploc, lat, lon FROM tiploc_geo WHERE tiploc IN (${tips.map(() => "?").join(",")})`)
  .all(...tips);
console.log("geo", geo);
const by = Object.fromEntries(geo.map((g) => [g.tiploc, g]));
if (by.WHRDJN && by.HOLBJCN) console.log("whrd-holb m", haversineM(by.WHRDJN, by.HOLBJCN));
if (by.HOLBJCN && by.COTNGLY) console.log("holb-cotn m", haversineM(by.HOLBJCN, by.COTNGLY));
if (by.WHRDJN && by.COTNGLY) console.log("whrd-cotn m", haversineM(by.WHRDJN, by.COTNGLY));

const edges = cat
  .prepare(
    `SELECT from_tpl, to_tpl, metres, source FROM orm_edges
     WHERE from_tpl IN ('WHRDJN','HOLBJCN','COTNGLY') OR to_tpl IN ('WHRDJN','HOLBJCN','COTNGLY')
     LIMIT 50`,
  )
  .all();
console.log("orm edges", edges);
cat.close();

const adj = loadOrmAdj(DATA_DIR);
const tipocMeta = loadTiplocMeta(DATA_DIR);
console.log("holbeck degree", (adj.get("HOLBJCN") || []).length, (adj.get("HOLBJCN") || []).slice(0, 8));
console.log("whrd degree", (adj.get("WHRDJN") || []).length, (adj.get("WHRDJN") || []).slice(0, 8));
console.log("path", ormIntermediatePath(adj, "WHRDJN", "COTNGLY", { tipocMeta, maxHops: 12 }));
console.log("holbeck meta", tipocMeta.get("HOLBJCN"));
console.log("hetnljn meta", tipocMeta.get("HETNLJN"));

const db = openDayDb(DATA_DIR, operatingDayYmd());
const calls = db
  .prepare(`SELECT tiploc, is_passing, wtp, actual_source, leg_m FROM calls WHERE rid=? ORDER BY seq`)
  .all("202610047116005");
const keep = new Set(["WHRDJN", "HOLBJCN", "COTNGLY", "MRLY", "BATLEY", "HETNLJN", "MIRFEJN", "MIRFILD", "LEEDS"]);
console.log(
  "around",
  calls.map((c, i) => ({ i, ...c })).filter((c) => keep.has(c.tiploc)),
);
db.close();
