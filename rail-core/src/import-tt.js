#!/usr/bin/env node
/**
 * Import a Darwin/CIF-style timetable into day-*.sqlite (stops and passes).
 * Usage: node src/import-tt.js ./tt/2026-09-30.cif
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { hhmm, openDayDb, upsertCall, upsertService } from "./db.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: node src/import-tt.js <cif-file>");
  process.exit(1);
}

const ymdGuess = basename(file).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || process.argv[3];
if (!ymdGuess) {
  console.error("pass a date YYYY-MM-DD as second arg if the filename has none");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const db = openDayDb(DATA_DIR, ymdGuess);
const text = readFileSync(file, "utf8");
const lines = text.split(/\r?\n/);

let current = null;
let seq = 0;
let nSvc = 0;
let nCall = 0;

function flush() {
  if (!current) return;
  upsertService(db, current.svc);
  nSvc++;
  for (const c of current.calls) {
    upsertCall(db, c);
    nCall++;
  }
}

function parseHhmm(s) {
  const t = String(s || "").replace(/\s/g, "");
  if (t.length < 4) return null;
  return hhmm(t.slice(0, 4));
}

for (const line of lines) {
  const rec = line.slice(0, 2);
  if (rec === "BS") {
    flush();
    const uid = line.slice(3, 9).trim();
    const runs = line.slice(9, 15).trim();
    const toc = line.slice(70, 72).trim() || null;
    const trainId = line.slice(32, 36).trim() || null;
    const status = line.slice(2, 3);
    current = {
      svc: {
        rid: `${ymdGuess}-${uid}-${runs || "1"}`,
        uid,
        train_id: trainId,
        rs_id: null,
        toc,
        operator_name: toc,
        origin_crs: null,
        origin_name: null,
        destination_crs: null,
        destination_name: null,
        via: null,
        service_type: status === "F" ? "freight" : "passenger",
        cancelled: 0,
        cancel_reason: null,
        delay_reason: null,
        is_charter: 0,
        category: line.slice(30, 32).trim() || null,
        headcode: trainId,
        updated_at: 1,
      },
      calls: [],
    };
    seq = 0;
    continue;
  }
  if (!current) continue;
  if (rec === "LO" || rec === "LI" || rec === "LT") {
    const tpl = line.slice(2, 10).trim();
    const isPass = rec === "LI" && line.slice(42, 44).trim() === "T";
    const wtd = parseHhmm(line.slice(15, 19));
    const wta = parseHhmm(line.slice(11, 15));
    const wtp = rec === "LI" ? parseHhmm(line.slice(15, 19)) : null;
    const ptd = parseHhmm(line.slice(37, 41));
    const pta = parseHhmm(line.slice(43, 47));
    const act = line.slice(42, 44).trim();
    const passing = rec === "LI" && (act === "T " || act === "T" || isPass) && !pta && !ptd;
    current.calls.push({
      rid: current.svc.rid,
      tiploc: tpl,
      crs: null,
      seq: seq++,
      is_passing: passing ? 1 : 0,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: pta,
      std: ptd,
      wta,
      wtd,
      wtp: passing ? wtp || wtd : null,
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
      updated_at: 1,
    });
    if (rec === "LO" && !current.svc.origin_crs) current.svc.origin_name = tpl;
    if (rec === "LT") current.svc.destination_name = tpl;
  }
}
flush();
console.log(`imported ${nSvc} services, ${nCall} calls into day-${ymdGuess}.sqlite`);
db.close();
