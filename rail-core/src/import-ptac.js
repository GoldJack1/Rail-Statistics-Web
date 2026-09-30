#!/usr/bin/env node
/**
 * Import PTAC catalog from a copied darwin-state.sqlite (read-only).
 */
import { DatabaseSync } from "node:sqlite";
import { openCatalog } from "./db.js";

const srcPath = process.argv[2];
if (!srcPath) {
  console.error("usage: node src/import-ptac.js /path/to/darwin-state.sqlite");
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const src = new DatabaseSync(srcPath, { readOnly: true });
const dest = openCatalog(DATA_DIR);
const tables = src.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
console.log("source tables:", tables.join(", "));

function copyGuess(table, mapRow) {
  if (!tables.includes(table)) return 0;
  const rows = src.prepare(`SELECT * FROM "${table}"`).all();
  let n = 0;
  for (const row of rows) {
    mapRow(row);
    n++;
  }
  return n;
}

let imported = 0;
imported += copyGuess("units", (row) => {
  const id = row.unit_id ?? row.unitId ?? row.id ?? row.unit;
  if (!id) return;
  dest.prepare(
    `INSERT INTO units (unit_id, class, operator, json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(unit_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`
  ).run(String(id), row.class ?? null, row.operator ?? row.toc ?? null, JSON.stringify(row), Date.now());
});
imported += copyGuess("unit", (row) => {
  const id = row.unit_id ?? row.id;
  if (!id) return;
  dest.prepare(
    `INSERT INTO units (unit_id, class, operator, json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(unit_id) DO UPDATE SET json=excluded.json`
  ).run(String(id), null, null, JSON.stringify(row), Date.now());
});

console.log("imported unit-like rows:", imported);
src.close();
dest.close();
