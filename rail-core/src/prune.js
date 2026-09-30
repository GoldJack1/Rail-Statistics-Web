#!/usr/bin/env node
import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const days = Number(process.env.RETENTION_DAYS ?? 30);
const cutoff = Date.now() - days * 86400000;

for (const f of readdirSync(DATA_DIR)) {
  const m = f.match(/^day-(\d{4})-(\d{2})-(\d{2})\.sqlite/);
  if (!m) continue;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (t < cutoff) {
    unlinkSync(join(DATA_DIR, f));
    for (const extra of [`${f}-wal`, `${f}-shm`]) {
      try {
        unlinkSync(join(DATA_DIR, extra));
      } catch {
        /* ignore */
      }
    }
    console.log("pruned", f);
  }
}
