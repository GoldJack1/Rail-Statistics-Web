import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { operatingDayYmd, openCatalog, openDayDb } from "./db.js";
import { applyParsed, fingerprint, parseDarwinPayload } from "./darwin-xml.js";
import { applyTrustMovement } from "./trust-apply.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PORT = Number(process.env.INGEST_PORT ?? 4003);

const lastFp = new Map();
const catalog = openCatalog(DATA_DIR);

function dbForNow() {
  return openDayDb(DATA_DIR, operatingDayYmd());
}

function ingestDarwin(raw) {
  const fp = fingerprint(raw);
  const parsed = parseDarwinPayload(raw);
  if (!parsed) {
    let hint = String(raw).slice(0, 80);
    try {
      const o = JSON.parse(String(raw));
      if (o && typeof o === "object") hint = `keys=${Object.keys(o).join(",")}`;
    } catch {
      /* keep slice */
    }
    return { ok: false, error: "unparsed", hint };
  }
  const rid = parsed.service.rid;
  if (rid && lastFp.get(rid) === fp) return { ok: true, skipped: true };
  const db = dbForNow();
  applyParsed(db, parsed);
  if (rid) lastFp.set(rid, fp);
  db.close();
  return { ok: true, skipped: false, rid };
}

function ingestTrust(body) {
  const db = dbForNow();
  const id = body.event_id ?? `${body.train_id ?? "x"}-${body.received_at ?? Date.now()}`;
  db.prepare(
    `INSERT OR REPLACE INTO trust_events (event_id, train_id, uid, loc_stanox, event_type, planned, actual, json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    body.train_id ?? null,
    body.uid ?? null,
    body.loc_stanox ?? null,
    body.event_type ?? null,
    body.planned ?? null,
    body.actual ?? null,
    JSON.stringify({ event_type: body.event_type, train_id: body.train_id, loc_stanox: body.loc_stanox }),
    Date.now()
  );
  db.close();
}

function ingestRtppm(json) {
  const db = dbForNow();
  db.prepare(`INSERT OR REPLACE INTO rtppm (snapshot_at, json) VALUES (?, ?)`).run(Date.now(), JSON.stringify(json));
  db.close();
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
      applyTrustMovement(DATA_DIR, body);
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
      catalog.prepare(
        `INSERT INTO units (unit_id, class, operator, json, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(unit_id) DO UPDATE SET class=excluded.class, operator=excluded.operator, json=excluded.json, updated_at=excluded.updated_at`
      ).run(body.unit_id, body.class ?? null, body.operator ?? null, JSON.stringify(body), Date.now());
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
