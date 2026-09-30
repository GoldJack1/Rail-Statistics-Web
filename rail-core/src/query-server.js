import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { dayPath, openCatalog, openDayDb, operatingDayYmd } from "./db.js";
import { tocDisplayName } from "./toc-names.js";
import { planBash } from "./bash-plan.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const TT_DIR = process.env.TT_DIR ?? "./tt";
const PORT = Number(process.env.QUERY_PORT ?? 4001);
const INTERNAL = process.env.INTERNAL_API_KEY ?? "";
const catalog = openCatalog(DATA_DIR);

function stationName(crs, tpl) {
  if (crs) {
    const row = catalog.prepare(`SELECT name FROM tiploc WHERE crs = ? LIMIT 1`).get(String(crs).toUpperCase());
    if (row?.name) return row.name;
  }
  if (tpl) {
    const row = catalog.prepare(`SELECT name FROM tiploc WHERE tiploc = ?`).get(String(tpl).toUpperCase());
    if (row?.name) return row.name;
  }
  return null;
}

function londonNowMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

function hhmmMinutes(value) {
  const s = String(value || "");
  if (!/^\d{2}:\d{2}/.test(s)) return null;
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
}

function inHoursWindow(call, hours, nowMins) {
  const stamp = call.etd || call.std || call.eta || call.sta || call.wtd || call.wta;
  const mins = hhmmMinutes(stamp);
  if (mins == null) return true;
  const from = nowMins - 10;
  const span = Math.max(1, hours) * 60;
  const to = nowMins + span;
  if (to < 24 * 60) return mins >= from && mins <= to;
  return mins >= from || mins <= to - 24 * 60;
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "Content-Type, X-API-Key");
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
  const liveKind = call.live_kind || "scheduled";
  const delayMinutes = call.delay_minutes;
  const cancelled = Boolean(svc.cancelled || call.cancelled);
  const originCrs = svc.origin_crs;
  const destCrs = svc.destination_crs;
  const originName = svc.origin_name || stationName(originCrs);
  const destName = svc.destination_name || stationName(destCrs);
  const tocName = tocDisplayName(svc.toc) || svc.operator_name || null;
  const trainId = svc.headcode && /^[0-9][A-Z][0-9]{2}$/i.test(svc.headcode) ? svc.headcode : "";
  return {
    rid: svc.rid,
    trainId,
    uid: svc.uid,
    toc: svc.toc,
    tocName,
    trainCat: svc.category,
    serviceType: svc.service_type || "passenger",
    isPassing: Boolean(call.is_passing),
    scheduledTime: planned,
    scheduledAt: `${ymd}T${planned || "00:00"}:00`,
    liveTime,
    liveKind,
    actualSource: call.actual_source,
    delayMinutes,
    platform: call.platform,
    livePlatform: call.platform,
    origin: originCrs,
    originName,
    originCrs,
    destination: destCrs,
    destinationName: destName,
    destinationCrs: destCrs,
    callingAfter: [],
    callingAfterNames: [],
    callingAfterCrs: [],
    isPassenger: svc.service_type !== "freight",
    cancelled,
    cancellation: svc.cancel_reason ? { source: "ts", reason: svc.cancel_reason } : null,
    delayReason: svc.delay_reason ? { source: "ts", reason: svc.delay_reason } : null,
    loadingPercentage: null,
    coachLoading: null,
    reverseFormation: false,
    hasConsist: false,
    hasAssociations: false,
    hasAlerts: false,
    status: cancelled
      ? "Cancelled"
      : delayMinutes
        ? `Delayed ${delayMinutes} min`
        : liveKind === "actual"
          ? "Departed"
          : "On time",
  };
}

function wrapBoard(crs, generatedAt, services, hours) {
  const code = String(crs).toUpperCase();
  const station = stationName(code) || code;
  return {
    code,
    tiploc: code,
    crs: code,
    name: station,
    generatedAt,
    updatedAt: generatedAt,
    services,
    departures: services,
    arrivals: [],
    stationName: station,
    stationCrs: code,
    matchedAs: "crs",
    timetableFile: "",
    windowHours: hours,
    counts: {
      departures: services.length,
      arrivals: 0,
      cancelled: services.filter((s) => s.cancelled).length,
      withDelay: services.filter((s) => s.delayMinutes).length,
      messages: 0,
    },
    messages: [],
    kafka: {
      consumed: 0,
      updatesApplied: 0,
      startedAt: generatedAt,
      lastMessageAt: generatedAt,
    },
  };
}

function departures(ymd, crs, opts) {
  const db = openDay(ymd);
  if (!db) {
    const generatedAt = new Date().toISOString();
    return wrapBoard(crs, generatedAt, [], opts.hours ?? 1);
  }
  const code = crs.toUpperCase();
  const tpls = catalog.prepare(`SELECT tiploc FROM tiploc WHERE crs = ?`).all(code).map((r) => r.tiploc);
  const placeholders = tpls.map(() => "?").join(",") || "NULL";
  const q = db.prepare(
    `SELECT c.*, s.rid as s_rid, s.uid, s.rs_id, s.toc, s.operator_name, s.origin_crs, s.origin_name,
            s.destination_crs, s.destination_name, s.via, s.service_type, s.cancelled as s_cancelled,
            s.cancel_reason, s.delay_reason, s.is_charter, s.category, s.headcode
     FROM calls c JOIN services s ON s.rid = c.rid
     WHERE (c.crs = ? ${tpls.length ? `OR c.tiploc IN (${placeholders})` : ""})
       ${opts.passengersOnly ? "AND s.service_type = 'passenger'" : ""}
     ORDER BY COALESCE(c.std, c.sta, c.wtd, c.wta, '99:99')`
  );
  const rows = q.all(code, ...tpls);
  const hours = Math.max(1, Number(opts.hours) || 1);
  const nowMins = londonNowMinutes();
  const dated = Boolean(opts.dated);
  const services = rows
    .filter((r) => dated || inHoursWindow(r, hours, nowMins))
    .map((r) =>
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
  return wrapBoard(crs, new Date().toISOString(), services, hours);
}

function serviceDetail(ymd, rid) {
  const db = openDay(ymd);
  if (!db) return null;
  const svc = db.prepare(`SELECT * FROM services WHERE rid = ?`).get(rid);
  if (!svc) {
    db.close();
    return null;
  }
  const calls = db.prepare(`SELECT * FROM calls WHERE rid = ? ORDER BY COALESCE(std, sta, wtd, wta, '99:99'), seq`).all(rid);
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
    name: stationName(c.crs, c.tiploc),
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
    tocName: tocDisplayName(svc.toc) || svc.operator_name,
    trainCat: svc.category,
    isPassenger: svc.service_type !== "freight",
    origin: svc.origin_crs,
    originName: svc.origin_name || stationName(svc.origin_crs),
    destination: svc.destination_crs,
    destinationName: svc.destination_name || stationName(svc.destination_crs),
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

function fleetIdOf(unitId, cls) {
  const fromClass = String(cls || "").match(/\d{3}/)?.[0];
  if (fromClass) return fromClass;
  return String(unitId || "").match(/^(\d{3})/)?.[1] || "other";
}

function unitsDays() {
  return listDates().filter((ymd) => {
    const db = openDay(ymd);
    if (!db) return false;
    const n = db.prepare(`SELECT COUNT(*) AS n FROM units`).get().n;
    db.close();
    return n > 0;
  });
}

function unitsFleets(day) {
  const counts = new Map();
  const bump = (id) => counts.set(id, (counts.get(id) || 0) + 1);
  if (day && day !== "all") {
    const db = openDay(day);
    if (db) {
      for (const row of db.prepare(`SELECT DISTINCT unit_id FROM units`).all()) bump(fleetIdOf(row.unit_id));
      db.close();
    }
  } else {
    for (const row of catalog.prepare(`SELECT unit_id, class FROM units`).all()) bump(fleetIdOf(row.unit_id, row.class));
  }
  return [...counts.entries()].map(([fleetId, unitCount]) => ({ fleetId, unitCount })).sort((a, b) => a.fleetId.localeCompare(b.fleetId));
}

function unitDetail(unitId, date) {
  const cat = catalog.prepare(`SELECT * FROM units WHERE unit_id = ?`).get(unitId);
  const ymd = date || operatingDayYmd();
  const db = openDay(ymd);
  const dayRows = db
    ? db.prepare(`SELECT * FROM units WHERE unit_id = ?`).all(unitId)
    : [];
  if (db) db.close();
  if (!cat && !dayRows.length) return null;
  const services = [];
  for (const row of dayRows) {
    if (!row.rid) continue;
    const detail = serviceDetail(ymd, row.rid);
    services.push({
      rid: row.rid,
      headcode: row.headcode || detail?.trainId || null,
      start: detail?.stops?.[0] ? `${ymd}T${detail.stops[0].ptd || detail.stops[0].pta || "00:00"}:00` : null,
      end: detail?.stops?.length
        ? `${ymd}T${detail.stops[detail.stops.length - 1].pta || detail.stops[detail.stops.length - 1].ptd || "00:00"}:00`
        : null,
      startTpl: detail?.stops?.[0]?.tpl || null,
      endTpl: detail?.stops?.[detail.stops.length - 1]?.tpl || null,
      startName: detail?.originName || null,
      endName: detail?.destinationName || null,
      position: null,
      reversed: false,
    });
  }
  let json = {};
  try {
    json = cat?.json ? JSON.parse(cat.json) : {};
  } catch {
    json = {};
  }
  return {
    unitId,
    fleetId: fleetIdOf(unitId, cat?.class),
    vehicles: json.vehicles || [],
    lastSeenRid: dayRows[0]?.rid || null,
    updatedAt: new Date().toISOString(),
    latestService: services[0] ? serviceDetail(ymd, services[0].rid) : null,
    services,
  };
}

const server = createServer(async (req, res) => {
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
      const hours = Number(url.searchParams.get("hours") || 1);
      const board = departures(date, dep[1], {
        passengersOnly: url.searchParams.get("passengers") === "1",
        hours,
        dated: Boolean(url.searchParams.get("date")),
      });
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
    if (req.method === "POST" && url.pathname === "/api/plan/bash") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        json(res, 400, { ok: false, error: "invalid json" });
        return;
      }
      const ymd = body.date || operatingDayYmd();
      const db = openDay(ymd);
      if (!db) {
        json(res, 404, { ok: false, error: "no day" });
        return;
      }
      const out = planBash(db, (crs) => stationName(crs) || crs, body);
      db.close();
      json(res, out.ok ? 200 : 400, out);
      return;
    }
    if (url.pathname === "/api/units/days") {
      json(res, 200, { days: unitsDays() });
      return;
    }
    if (url.pathname === "/api/units/fleets") {
      json(res, 200, { fleets: unitsFleets(url.searchParams.get("day") || "all") });
      return;
    }
    if (url.pathname === "/api/units/catalog") {
      const units = catalog.prepare(`SELECT unit_id, class, operator, updated_at FROM units`).all();
      json(res, 200, { units, updatedAt: new Date().toISOString() });
      return;
    }
    const unitOne = url.pathname.match(/^\/api\/unit\/([^/]+)$/);
    if (unitOne) {
      const detail = unitDetail(decodeURIComponent(unitOne[1]), url.searchParams.get("date") || undefined);
      json(res, detail ? 200 : 404, detail ?? { error: "not found" });
      return;
    }
    if (url.pathname.startsWith("/api/units/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/units/".length));
      const detail = unitDetail(id, url.searchParams.get("date") || undefined);
      json(res, detail ? 200 : 404, detail ?? { error: "not found" });
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
