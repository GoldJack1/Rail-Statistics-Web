import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { operatingDayYmd, openCatalog, openDayDb, refreshServiceJourney } from "./db.js";
import { applyParsed, fingerprint, parseDarwinPayload } from "./darwin-xml.js";
import { applyTrustMovement } from "./trust-apply.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PORT = Number(process.env.INGEST_PORT ?? 4003);

const lastFp = new Map();
const catalog = openCatalog(DATA_DIR);
let dayYmd = null;
let dayDb = null;

function dbForNow() {
  const y = operatingDayYmd();
  if (dayDb && dayYmd === y) return dayDb;
  if (dayDb) {
    try {
      dayDb.close();
    } catch {
      /* ignore */
    }
  }
  dayDb = openDayDb(DATA_DIR, y);
  dayYmd = y;
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
        const emptyText = o.text && typeof o.text === "object" && Object.keys(o.text).length === 0;
        if (emptyText) return { ok: true, skipped: true, kind: "non-ts" };
      }
    } catch {
      /* keep slice */
    }
    return { ok: false, error: "unparsed", hint };
  }
  const rid = parsed.service.rid;
  if (rid && lastFp.get(rid) === fp) return { ok: true, skipped: true };
  fillCrsFromCatalog(parsed);
  applyParsed(dbForNow(), parsed);
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
  if (rid) refreshServiceJourney(dbForNow(), rid, nameLookup);
  if (rid) lastFp.set(rid, fp);
  return { ok: true, skipped: false, rid };
}

function mapTrustItem(item) {
  const header = item?.header || {};
  const body = item?.body || item || {};
  const ts = body.actual_timestamp || body.gbtt_timestamp || body.event_time;
  let actual = body.actual || null;
  if (!actual && ts) {
    const n = Number(ts);
    const d = new Date(Number.isFinite(n) && String(ts).length > 10 ? n : Date.parse(String(ts)));
    if (!Number.isNaN(d.getTime())) {
      actual = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    }
  }
  const event = String(body.event_type || body.eventType || header.msg_type || "").toUpperCase();
  return {
    event_id: `${body.train_id || body.trainId || "x"}-${ts || Date.now()}`,
    train_id: body.train_id || body.trainId || null,
    uid: body.train_uid || body.uid || null,
    loc_stanox: body.loc_stanox || body.locStanox || null,
    event_type: event,
    planned: body.planned_timestamp || body.planned || null,
    actual,
    toc: body.toc_id || body.toc || null,
    is_pass: event.includes("PASS"),
    service_type: event.includes("FREIGHT") ? "freight" : "passenger",
  };
}

function ingestTrust(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.messages) ? body.messages : [body];
  const db = dbForNow();
  for (const item of items) {
    const mapped = mapTrustItem(item);
    const id = mapped.event_id;
    db.prepare(
      `INSERT OR REPLACE INTO trust_events (event_id, train_id, uid, loc_stanox, event_type, planned, actual, json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      mapped.train_id,
      mapped.uid,
      mapped.loc_stanox,
      mapped.event_type,
      mapped.planned,
      mapped.actual,
      JSON.stringify({ event_type: mapped.event_type, train_id: mapped.train_id, loc_stanox: mapped.loc_stanox }),
      Date.now()
    );
    applyTrustMovement(DATA_DIR, mapped);
  }
}

function ingestRtppm(json) {
  const db = dbForNow();
  db.prepare(`INSERT OR REPLACE INTO rtppm (snapshot_at, json) VALUES (?, ?)`).run(Date.now(), JSON.stringify(json));
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
    const body = raw ? JSON.parse(raw) : {};
    if (url.pathname === "/ingest/trust") {
      ingestTrust(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/ingest/rtppm") {
      ingestRtppm(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/ingest/unit") {
      const unitId = body.unit_id || body.unitId || body.resourceGroupId;
      if (!unitId) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unit_id required" }));
        return;
      }
      const cls = body.class ?? null;
      catalog.prepare(
        `INSERT INTO units (unit_id, class, operator, json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(unit_id) DO UPDATE SET class=COALESCE(excluded.class, units.class), operator=COALESCE(excluded.operator, units.operator), json=excluded.json, updated_at=excluded.updated_at`
      ).run(String(unitId), cls, body.operator ?? null, JSON.stringify(body.json || body), Date.now());
      const rid = body.rid;
      if (rid) {
        const day = body.operating_day || operatingDayYmd();
        const ddb = day === dayYmd ? dbForNow() : openDayDb(DATA_DIR, day);
        ddb.prepare(
          `INSERT INTO units (unit_id, operating_day, rid, toc, headcode, diagram)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(unit_id, operating_day, rid) DO UPDATE SET toc=excluded.toc, headcode=excluded.headcode, diagram=excluded.diagram`
        ).run(String(unitId), day, String(rid), body.operator ?? null, body.headcode ?? null, body.diagram ?? null);
        if (day !== dayYmd) {
          try {
            ddb.close();
          } catch {
            /* ignore */
          }
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
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
});
