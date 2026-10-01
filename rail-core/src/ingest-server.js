import "./load-env.js";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { darwinWriteDays } from "./calendar-day.js";
import { operatingDayYmd, openCatalog, openDayDb, refreshServiceJourney } from "./db.js";
import { applyParsed, fingerprint, parseDarwinPayload } from "./darwin-xml.js";
import { applyPtacUnit } from "./ptac-apply.js";
import { timetableNeedsImportFromDb } from "./ensure-timetable.js";

function mergedUnitJson(catalog, unitId, incoming) {
  let prev = {};
  const existing = catalog.prepare(`SELECT json FROM units WHERE unit_id = ?`).get(String(unitId));
  try {
    prev = existing?.json ? JSON.parse(existing.json) : {};
  } catch {
    prev = {};
  }
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const keepVehicles = prev.vehicles_json && !next.vehicles_json && !next.vehicles;
  return {
    ...prev,
    ...next,
    unit_id: String(unitId),
    fleet_id: next.fleet_id || next.fleetId || prev.fleet_id || prev.fleetId,
    vehicles_json: keepVehicles ? prev.vehicles_json : next.vehicles_json || prev.vehicles_json,
    vehicles: next.vehicles || prev.vehicles,
  };
}

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PORT = Number(process.env.INGEST_PORT ?? 4003);

const lastFp = new Map();
const catalog = openCatalog(DATA_DIR);
let dayYmd = null;
let dayDb = null;

function ridYmd(rid) {
  const s = String(rid || "");
  if (!/^\d{8}/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const dayDbs = new Map();

function dbForYmd(y) {
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(y || "") ? y : operatingDayYmd();
  if (ymd === dayYmd && dayDb) return dayDb;
  let db = dayDbs.get(ymd);
  if (db) return db;
  db = openDayDb(DATA_DIR, ymd);
  dayDbs.set(ymd, db);
  return db;
}

function dbForNow() {
  const y = operatingDayYmd();
  if (dayDb && dayYmd === y) return dayDb;
  if (dayDb) {
    dayDbs.delete(dayYmd);
    try {
      dayDb.close();
    } catch {
      /* ignore */
    }
  }
  dayDb = openDayDb(DATA_DIR, y);
  dayYmd = y;
  dayDbs.set(y, dayDb);
  return dayDb;
}

function rememberTiploc(call) {
  if (!call.tiploc || !call.crs) return;
  catalog.prepare(
    `INSERT INTO tiploc (tiploc, crs, name) VALUES (?, ?, ?)
     ON CONFLICT(tiploc) DO UPDATE SET crs=COALESCE(excluded.crs, tiploc.crs)`
  ).run(call.tiploc, call.crs, null);
}

function fillCrsFromCatalog(parsed) {
  const lookup = catalog.prepare(`SELECT crs FROM tiploc WHERE tiploc = ?`);
  for (const call of parsed.calls) {
    if (!call.crs && call.tiploc) {
      const row = lookup.get(String(call.tiploc).toUpperCase());
      if (row?.crs) call.crs = row.crs;
    }
    rememberTiploc(call);
  }
  const stops = parsed.calls.filter((c) => c.crs && !c.is_passing);
  if (!parsed.service.origin_crs && stops[0]?.crs) {
    parsed.service.origin_crs = stops[0].crs;
  }
  const last = stops[stops.length - 1];
  if (!parsed.service.destination_crs && last?.crs) {
    parsed.service.destination_crs = last.crs;
  }
}

function ingestDarwin(raw) {
  const fp = fingerprint(raw);
  const parsed = parseDarwinPayload(raw);
  if (!parsed) {
    let hint = String(raw).slice(0, 80);
    try {
      const o = JSON.parse(String(raw));
      if (o && typeof o === "object") {
        const textKeys = o.text && typeof o.text === "object" ? Object.keys(o.text).slice(0, 20).join(",") : "";
        hint = `textType=${typeof o.text} textKeys=${textKeys} bytesType=${typeof o.bytes}`;
        const emptyText =
          o.text == null ||
          (typeof o.text === "object" && !Array.isArray(o.text) && Object.keys(o.text).length === 0);
        const bytes = typeof o.bytes === "string" ? o.bytes : "";
        hint = `textType=${typeof o.text} bytesLen=${bytes.length} head=${bytes.slice(0, 70)}`;
        if (
          emptyText &&
          !/"Location"\s*:/i.test(bytes) &&
          !/"locations"\s*:/i.test(bytes) &&
          !/"schedule"\s*:/i.test(bytes) &&
          !/"OR"\s*:/.test(bytes) &&
          !/"IP"\s*:/.test(bytes) &&
          !/"PP"\s*:/.test(bytes) &&
          !/"DT"\s*:/.test(bytes)
        ) {
          return { ok: true, skipped: true, kind: "non-ts" };
        }
      }
    } catch {
      /* keep slice */
    }
    return { ok: false, error: "unparsed", hint };
  }
  if (!globalThis.__dumpedUnparsed) {
    globalThis.__dumpedUnparsed = true;
    try {
      const o = JSON.parse(String(raw));
      const b = o.bytes;
      const dump = {
        keys: Object.keys(o),
        dest: o.destination || null,
        textType: typeof o.text,
        bytesType: typeof b,
        bytesLen: typeof b === "string" ? b.length : Array.isArray(b) ? b.length : null,
        bytesHeadCodes: typeof b === "string" ? [...String(b).slice(0, 12)].map((c) => c.charCodeAt(0)) : null,
        bytesHead: typeof b === "string" ? String(b).slice(0, 80) : null,
      };
      writeFileSync(join(DATA_DIR, "unparsed-sample.json"), JSON.stringify(dump).slice(0, 4000));
    } catch {
      writeFileSync(join(DATA_DIR, "unparsed-sample.txt"), String(raw).slice(0, 500));
    }
  }
  const rid = parsed.service.rid;
  if (rid && lastFp.get(rid) === fp) return { ok: true, skipped: true };
  fillCrsFromCatalog(parsed);
  const nameLookup = (crs, tpl) => {
    if (crs) {
      const byCrs = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`).get(crs);
      if (byCrs?.name) return byCrs.name;
    }
    if (tpl) {
      const byTpl = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`).get(String(tpl).toUpperCase());
      if (byTpl?.name) return byTpl.name;
    }
    return null;
  };
  const op = operatingDayYmd();
  const ssd = ridYmd(rid);
  const hasRid = (day) => {
    const db = day === op ? dbForNow() : dbForYmd(day);
    return Boolean(rid && db.prepare(`SELECT 1 AS n FROM services WHERE rid = ?`).get(rid));
  };
  const days = darwinWriteDays(op, ssd, hasRid);
  for (const day of days) {
    const db = day === op ? dbForNow() : dbForYmd(day);
    applyParsed(db, parsed);
    if (rid) refreshServiceJourney(db, rid, nameLookup);
  }
  if (rid) lastFp.set(rid, fp);
  return { ok: true, skipped: false, rid };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "ingest", day: operatingDayYmd() }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    if (url.pathname === "/ingest/darwin") {
      const out = ingestDarwin(raw);
      res.writeHead(out.ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    if (url.pathname === "/ingest/trust") {
      const { trustMessages } = await import("./trust-parse.js");
      const { applyTrustFrame } = await import("./trust-apply.js");
      let n = 0;
      for (const msg of trustMessages(raw)) {
        if (applyTrustFrame(DATA_DIR, msg)) n++;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, applied: n }));
      return;
    }
    if (url.pathname === "/ingest/rtppm") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, skipped: true }));
      return;
    }
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/ingest/unit") {
      const out = applyPtacUnit(catalog, body);
      res.writeHead(out.ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
});

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(join(DATA_DIR, "ingest.pid"), String(process.pid));
server.listen(PORT, "127.0.0.1", () => {
  console.log(`rail-core ingest on 127.0.0.1:${PORT}`);
  if (timetableNeedsImportFromDb(dbForNow(), operatingDayYmd())) {
    console.log("timetable missing on boot — fetching");
    spawn(process.execPath, ["src/fetch-timetable.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      detached: true,
    }).unref();
  }
});
