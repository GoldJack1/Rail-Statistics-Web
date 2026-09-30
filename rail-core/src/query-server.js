import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { dayPath, openCatalog, openDayDb, operatingDayYmd } from "./db.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TT_DIR = process.env.TT_DIR ?? "./tt";
const PORT = Number(process.env.QUERY_PORT ?? 4001);
const INTERNAL = process.env.INTERNAL_API_KEY ?? "";

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

function json(res, status, body, extra = {}) {
  cors(res);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function ymdValid(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function openDay(ymd) {
  const p = dayPath(DATA_DIR, ymd);
  if (!existsSync(p)) return null;
  return openDayDb(DATA_DIR, ymd);
}

function boardRow(ymd, svc, call) {
  const planned = call.std || call.sta;
  const actual = call.atd || call.ata || call.atp;
  const est = call.etd || call.eta || call.etp;
  const liveTime = actual || est || planned || "";
  return {
    rid: svc.rid,
    trainId: svc.headcode || svc.uid,
    uid: svc.uid,
    toc: svc.toc,
    tocName: svc.operator_name,
    trainCat: svc.category,
    serviceType: svc.service_type || "passenger",
    isPassing: Boolean(call.is_passing),
    scheduledTime: planned,
    scheduledAt: `${ymd}T${planned || "00:00"}:00`,
    liveTime,
    liveKind: call.live_kind || "scheduled",
    actualSource: call.actual_source,
    delayMinutes: call.delay_minutes,
    platform: call.platform,
    livePlatform: call.platform,
    origin: svc.origin_crs,
    originName: svc.origin_name,
    originCrs: svc.origin_crs,
    destination: svc.destination_crs,
    destinationName: svc.destination_name,
    destinationCrs: svc.destination_crs,
    callingAfter: [],
    callingAfterNames: [],
    callingAfterCrs: [],
    isPassenger: svc.service_type !== "freight",
    cancelled: Boolean(svc.cancelled || call.cancelled),
    cancellation: svc.cancel_reason ? { source: "ts", reason: svc.cancel_reason } : null,
    delayReason: svc.delay_reason ? { source: "ts", reason: svc.delay_reason } : null,
    loadingPercentage: null,
    coachLoading: null,
    reverseFormation: false,
    hasConsist: false,
  };
}

function departures(ymd, crs, opts) {
  const db = openDay(ymd);
  if (!db) {
    const generatedAt = new Date().toISOString();
    return {
      code: crs.toUpperCase(),
      tiploc: crs.toUpperCase(),
      crs: crs.toUpperCase(),
      name: crs.toUpperCase(),
      generatedAt,
      updatedAt: generatedAt,
      services: [],
    };
  }
  const q = db.prepare(
    `SELECT c.*, s.rid as s_rid, s.uid, s.rs_id, s.toc, s.operator_name, s.origin_crs, s.origin_name,
            s.destination_crs, s.destination_name, s.via, s.service_type, s.cancelled as s_cancelled,
            s.cancel_reason, s.delay_reason, s.is_charter, s.category, s.headcode
     FROM calls c JOIN services s ON s.rid = c.rid
     WHERE c.crs = ? ${opts.passengersOnly ? "AND s.service_type = 'passenger'" : ""}
     ORDER BY COALESCE(c.std, c.sta, c.wtd, c.wta, '99:99')`
  );
  const rows = q.all(crs.toUpperCase());
  const services = rows.map((r) =>
    boardRow(ymd,
      {
        rid: r.s_rid,
        uid: r.uid,
        rs_id: r.rs_id,
        toc: r.toc,
        operator_name: r.operator_name,
        origin_crs: r.origin_crs,
        origin_name: r.origin_name,
        destination_crs: r.destination_crs,
        destination_name: r.destination_name,
        via: r.via,
        service_type: r.service_type,
        cancelled: r.s_cancelled,
        cancel_reason: r.cancel_reason,
        delay_reason: r.delay_reason,
        is_charter: r.is_charter,
        category: r.category,
        headcode: r.headcode,
      },
      r
    )
  );
  db.close();
  const generatedAt = new Date().toISOString();
  return {
    code: crs.toUpperCase(),
    tiploc: crs.toUpperCase(),
    crs: crs.toUpperCase(),
    name: crs.toUpperCase(),
    generatedAt,
    updatedAt: generatedAt,
    services,
  };
}

function serviceDetail(ymd, rid) {
  const db = openDay(ymd);
  if (!db) return null;
  const svc = db.prepare(`SELECT * FROM services WHERE rid = ?`).get(rid);
  if (!svc) {
    db.close();
    return null;
  }
  const calls = db.prepare(`SELECT * FROM calls WHERE rid = ? ORDER BY seq`).all(rid);
  const units = db.prepare(`SELECT unit_id FROM units WHERE rid = ?`).all(rid).map((u) => u.unit_id);
  const callingPoints = calls.map((c) => ({
      crs: c.crs,
      tiploc: c.tiploc,
      seq: c.seq,
      isPassing: Boolean(c.is_passing),
      platform: c.platform,
      sta: c.sta,
      std: c.std,
      wta: c.wta,
      wtd: c.wtd,
      wtp: c.wtp,
      ata: c.ata,
      atd: c.atd,
      atp: c.atp,
      eta: c.eta,
      etd: c.etd,
      etp: c.etp,
      liveKind: c.live_kind,
      actualSource: c.actual_source,
    }));
  const last = callingPoints.length - 1;
  const stops = callingPoints.map((c, i) => ({
    tpl: c.tiploc,
    name: null,
    crs: c.crs,
    slot: c.isPassing ? "PP" : i === 0 ? "OR" : i === last ? "DT" : "IP",
    pta: c.sta,
    ptd: c.std,
    wta: c.wta,
    wtd: c.wtd,
    wtp: c.wtp,
    ata: c.ata,
    atd: c.atd,
    atp: c.atp,
    platform: c.platform,
    livePlatform: c.platform,
    activity: null,
    liveTime: c.atd || c.ata || c.atp || c.etd || c.eta || c.etp,
    liveKind: c.liveKind,
    cancelledAtStop: false,
    cancelReasonAtStop: null,
    loadingPercentage: null,
    coachLoading: null,
    actualSource: c.actualSource,
  }));
  db.close();
  return {
    rid: svc.rid,
    uid: svc.uid,
    trainId: svc.headcode,
    ssd: ymd,
    toc: svc.toc,
    tocName: svc.operator_name,
    trainCat: svc.category,
    isPassenger: svc.service_type !== "freight",
    origin: svc.origin_crs,
    originName: svc.origin_name,
    destination: svc.destination_crs,
    destinationName: svc.destination_name,
    cancelled: Boolean(svc.cancelled),
    cancellation: null,
    partiallyCancelled: false,
    delayReason: null,
    reverseFormation: false,
    formation: null,
    consist: null,
    associations: [],
    alerts: [],
    stops,
    callingPoints,
    units,
    serviceType: svc.service_type,
    updatedAt: new Date().toISOString(),
  };
}

function listDates() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter((f) => /^day-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
    .map((f) => f.slice(4, 14))
    .sort();
}

const catalog = openCatalog(DATA_DIR);

const server = createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const key =
    url.searchParams.get("key") ??
    req.headers["x-internal-key"] ??
    req.headers["x-api-key"];
  if (INTERNAL && key !== INTERNAL) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  try {
    if (url.pathname === "/health" || url.pathname === "/api/health" || url.pathname === "/api/ping") {
      json(res, 200, { ok: true, role: "query", day: operatingDayYmd(), dates: listDates().length });
      return;
    }
    const dep = url.pathname.match(/^\/api\/departures\/([A-Z]{3})$/i);
    if (dep) {
      const date = url.searchParams.get("date") || operatingDayYmd();
      if (!ymdValid(date)) {
        json(res, 400, { error: "bad date" });
        return;
      }
      const board = departures(date, dep[1], { passengersOnly: url.searchParams.get("passengers") === "1" });
      const cache =
        date < operatingDayYmd()
          ? { "cache-control": "public, max-age=300, s-maxage=3600" }
          : { "cache-control": "public, max-age=15, s-maxage=15" };
      json(res, 200, board, cache);
      return;
    }
    const svcRid = url.pathname.match(/^\/api\/service\/([^/]+)$/);
    if (svcRid) {
      const date = url.searchParams.get("date") || operatingDayYmd();
      const detail = serviceDetail(date, decodeURIComponent(svcRid[1]));
      if (!detail) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, detail, { "cache-control": "public, max-age=60" });
      return;
    }
    const svc = url.pathname.match(/^\/api\/service\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
    if (svc) {
      const detail = serviceDetail(svc[2], decodeURIComponent(svc[1]));
      if (!detail) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, detail, { "cache-control": "public, max-age=60" });
      return;
    }
    if (url.pathname === "/api/dates" || url.pathname === "/api/history/dates") {
      json(res, 200, { dates: listDates() });
      return;
    }
    if (url.pathname.startsWith("/api/units/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/units/".length));
      const row = catalog.prepare(`SELECT * FROM units WHERE unit_id = ?`).get(id);
      json(res, row ? 200 : 404, row ?? { error: "not found" });
      return;
    }
    if (url.pathname === "/api/window") {
      const dates = listDates();
      const today = operatingDayYmd();
      json(res, 200, {
        timetableWindow: {
          minDate: dates[0] || today,
          maxDate: dates[dates.length - 1] || today,
        },
        dates,
        ttDir: TT_DIR,
      });
      return;
    }
    if (url.pathname === "/api/rtppm") {
      const ymd = url.searchParams.get("date") || operatingDayYmd();
      const db = openDay(ymd);
      if (!db) {
        json(res, 404, { error: "no day" });
        return;
      }
      const row = db.prepare(`SELECT * FROM rtppm ORDER BY snapshot_at DESC LIMIT 1`).get();
      db.close();
      json(res, 200, row ? JSON.parse(row.json) : { snapshots: [] });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`rail-core query on 127.0.0.1:${PORT}`);
});
