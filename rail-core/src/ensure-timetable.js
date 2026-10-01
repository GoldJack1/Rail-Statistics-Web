#!/usr/bin/env node
/**
 * If today's day DB has no timetable import, run fetch-timetable.js.
 * Called on ingest boot and as a oneshot after reboot.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dayPath, openDayDb, operatingDayYmd } from "./db.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

export function timetableNeedsImportFromDb(db, ymd) {
  const meta = db.prepare(`SELECT value FROM meta WHERE key = 'timetable_imported'`).get();
  const n = db.prepare(`SELECT COUNT(*) AS n FROM calls`).get().n;
  return meta?.value !== ymd || n < 500;
}

export function timetableNeedsImport(dataDir = DATA_DIR) {
  const ymd = operatingDayYmd();
  if (!existsSync(dayPath(dataDir, ymd))) return true;
  const db = openDayDb(dataDir, ymd);
  try {
    return timetableNeedsImportFromDb(db, ymd);
  } finally {
    db.close();
  }
}

export function spawnTimetableFetch() {
  const child = spawn(process.execPath, ["src/fetch-timetable.js"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    detached: true,
  });
  child.unref();
  return child;
}

if (process.argv[1] && process.argv[1].endsWith("ensure-timetable.js")) {
  if (!timetableNeedsImport()) {
    console.log("timetable already present for", operatingDayYmd());
    process.exit(0);
  }
  console.log("timetable missing — fetching");
  const child = spawn(process.execPath, ["src/fetch-timetable.js"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}
