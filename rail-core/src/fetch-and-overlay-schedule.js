#!/usr/bin/env node
/**
 * ~06:30 Europe/London: fetch daily ITPS SCHEDULE, overlay onto Darwin,
 * then optional path enrichment (ORM stitch; legacy densify off by default).
 *
 * TT_GEOM_DENSIFY=1 re-enables legacy geometry densify (off by default).
 * TT_ORM_PATH=0 disables ORM path stitch (on by default when graph present).
 * TT_GRAPH_FILL=1 is legacy and off by default.
 */
import "./load-env.js";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { openDayDb, operatingDayYmd } from "./db.js";
import { applyWorkingsOverlay, loadScheduleWorkings } from "./cif-overlay.js";
import { fetchItpsSchedule, pickLocalItpsFile, readItpsMeta } from "./fetch-schedule.js";
import { densifyIntermediateGeometryForDay } from "./geometry-densify.js";
import { fillIntermediatePassesForDay } from "./fill-intermediate-passes.js";
import { stitchOrmPathsForDay } from "./orm-path.js";
import { mineEdgesFromScheduleFile, saveEdgesToCatalog } from "./tiploc-graph.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const today = operatingDayYmd();
const geomDensify = String(process.env.TT_GEOM_DENSIFY || "").trim() === "1";
const ormPath = String(process.env.TT_ORM_PATH ?? "1").trim() !== "0";
const graphFill = String(process.env.TT_GRAPH_FILL || "").trim() === "1";
const graceMin = Math.min(90, Math.max(5, Number(process.env.TT_SCHEDULE_GRACE_MIN || 60) || 60));
const retrySec = Math.min(180, Math.max(30, Number(process.env.TT_SCHEDULE_RETRY_SEC || 120) || 120));
const deadline = Date.now() + graceMin * 60 * 1000;

function sleep(sec) {
  spawnSync("sleep", [String(Math.max(1, Math.round(sec)))], { stdio: "ignore" });
}

async function fetchWithRetry() {
  let last = { path: null, meta: null };
  while (Date.now() < deadline) {
    last = await fetchItpsSchedule();
    const meta = last.meta || readItpsMeta();
    if (last.path && meta?.source === "json-full") return last;
    if (last.path && meta?.source?.startsWith("cif")) {
      console.warn("have CIF fallback; still preferring JSON until grace ends");
    } else {
      console.warn("ITPS SCHEDULE not ready; retry in", retrySec, "s");
    }
    if (Date.now() + retrySec * 1000 >= deadline) break;
    sleep(retrySec);
  }
  if (!last.path) last = { path: pickLocalItpsFile(), meta: readItpsMeta() };
  return last;
}

const { path, meta } = await fetchWithRetry();
if (!path) {
  console.error("no ITPS SCHEDULE file — abort overlay");
  process.exit(1);
}

console.log("ITPS source", meta?.source || "local", basename(path));

console.log("overlay workings onto", today);
const workings = await loadScheduleWorkings(path, today);
const overlay = applyWorkingsOverlay(DATA_DIR, today, workings);
console.log("overlay", overlay);

console.log("mine TIPLOC schedule graph (ORM edge seed)");
{
  const edges = await mineEdgesFromScheduleFile(path);
  const edgeCount = saveEdgesToCatalog(DATA_DIR, edges);
  console.log("tiploc edges", edgeCount);
}

if (ormPath) {
  console.log("ORM path stitch + mileage");
  const stitch = stitchOrmPathsForDay(DATA_DIR, today, { scheduleFile: path });
  console.log("ORM path", stitch);
} else {
  console.log("ORM path skipped (TT_ORM_PATH=0)");
}

if (geomDensify) {
  console.warn("legacy TT_GEOM_DENSIFY=1 — prefer ORM path");
  console.log("geometry densify");
  const densify = await densifyIntermediateGeometryForDay(DATA_DIR, today, {
    scheduleFile: path,
  });
  console.log("geometry densify", densify);
}

if (graphFill) {
  console.warn("legacy TT_GRAPH_FILL=1 — prefer ORM path");
  console.log("fill intermediate passes");
  const fill = fillIntermediatePassesForDay(DATA_DIR, today);
  console.log("graph fill", fill);
}

const db = openDayDb(DATA_DIR, today);
db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('itps_schedule_source', ?)`).run(
  meta?.source || basename(path),
);
db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('itps_fetched_at', ?)`).run(
  meta?.fetchedAt || new Date().toISOString(),
);
db.close();

console.log("schedule overlay done");
