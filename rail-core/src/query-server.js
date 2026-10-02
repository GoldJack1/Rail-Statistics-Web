import "./load-env.js";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { dayPath, openCatalog, openDayDb, operatingDayYmd, platformText } from "./db.js";
import { addCalendarDays, locationBoardDays, londonCalendarYmd, londonInstant, ssdFromRid } from "./calendar-day.js";
import { stationCrsGroup, tiplocsForStation } from "./station-groups.js";
import { tocDisplayName } from "./toc-names.js";
import { formatTiplocName } from "./tiploc-names.js";
import { collapseCallsByTiploc, sortCallsByJourneyTime } from "./journey-order.js";
import { buildStationBoard, collapseDuplicateBoardRows, liveClockFromCall } from "./board-build.js";
import { maskCallsAsOf, parseAtParam } from "./replay-at.js";
import { computeServiceLocation, locationIsFresh } from "./location.js";
import { ensureDayImported, ridNeedsHsp, ridsNeedHsp, startBoardHspFill } from "./ensure-history-day.js";
import { consistDocument, lookupConsist, normalizePtacVehicles, unitIdsFromConsistRow } from "./ptac-apply.js";
import {
  associationsForRid,
  combinedDestinationName,
  inferAssociationsFromConsist,
  inferScheduleDivides,
  mergeAssociations,
  collapseOvernightAssociates,
  filterDisplayAssociations,
  persistInferred,
} from "./associations.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const PORT = Number(process.env.QUERY_PORT ?? 4001);
const INTERNAL = process.env.INTERNAL_API_KEY ?? "";
const catalog = openCatalog(DATA_DIR);

let namedTiplocCache = { at: 0, rows: [] };
function namedTiplocs() {
  const now = Date.now();
  if (now - namedTiplocCache.at > 60_000) {
    namedTiplocCache = {
      at: now,
      rows: catalog
        .prepare(
          `SELECT tiploc, name FROM corpus
           WHERE name IS NOT NULL AND trim(name) != '' AND UPPER(name) != tiploc`,
        )
        .all(),
    };
  }
  return namedTiplocCache.rows;
}

function stationName(crs, tpl) {
  let official = null;
  if (tpl) {
    const byCorpus = catalog
      .prepare(`SELECT name, crs FROM corpus WHERE tiploc = ?`)
      .get(String(tpl).toUpperCase());
    if (byCorpus?.name) official = byCorpus.name;
    if (!official) {
      const byTpl = catalog.prepare(`SELECT name, crs FROM tiploc WHERE tiploc = ?`).get(String(tpl).toUpperCase());
      if (byTpl?.name) official = byTpl.name;
    }
  }
  if (!official && crs) {
    const row =
      catalog
        .prepare(
          `SELECT name FROM corpus WHERE crs = ? AND name IS NOT NULL AND name != '' LIMIT 1`,
        )
        .get(String(crs).toUpperCase()) ||
      catalog
        .prepare(`SELECT name FROM tiploc WHERE crs = ? AND name IS NOT NULL AND name != '' LIMIT 1`)
        .get(String(crs).toUpperCase());
    if (row?.name) official = row.name;
  }
  return formatTiplocName(tpl, official, official ? [] : namedTiplocs());
}

function londonNow() {
  return new Date();
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

function timetableHorizonYmd() {
  return addCalendarDays(londonCalendarYmd(), Number(process.env.TT_LOOKAHEAD_DAYS || 6));
}

function listDayYmds() {
  try {
    return readdirSync(DATA_DIR)
      .map((n) => n.match(/^day-(\d{4}-\d{2}-\d{2})\.sqlite$/)?.[1])
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

const dayPool = new Map();
const boardSnap = new Map();

function openDay(ymd) {
  const p = dayPath(DATA_DIR, ymd);
  if (!existsSync(p)) return null;
  let db = dayPool.get(ymd);
  if (db) return db;
  db = openDayDb(DATA_DIR, ymd);
  dayPool.set(ymd, db);
  return db;
}

function catalogTiplocsForCrs(crs) {
  const rows = [
    ...catalog.prepare(`SELECT tiploc FROM tiploc WHERE crs = ?`).all(crs),
    ...catalog.prepare(`SELECT tiploc FROM corpus WHERE crs = ?`).all(crs),
  ];
  return rows.map((r) => String(r.tiploc || "").toUpperCase()).filter(Boolean);
}

function resolveBoardLocation(code) {
  const c = String(code || "").toUpperCase();
  const asTpl =
    catalog.prepare(`SELECT tiploc, crs FROM corpus WHERE tiploc = ?`).get(c) ||
    catalog.prepare(`SELECT tiploc, crs FROM tiploc WHERE tiploc = ?`).get(c);
  const stationCode = asTpl && c.length !== 3 ? String(asTpl.crs || c).toUpperCase() : c;
  const grouped = stationCrsGroup(stationCode);
  if (grouped || (c.length === 3 && catalogTiplocsForCrs(c).length)) {
    const merged = tiplocsForStation(stationCode, catalogTiplocsForCrs);
    return { crs: stationCode, tiplocs: merged.tiplocs, matchedAs: "crs" };
  }
  if (asTpl && c.length !== 3) {
    return { crs: String(asTpl.crs || c).toUpperCase(), tiplocs: [c], matchedAs: "tiploc" };
  }
  if (asTpl) {
    return { crs: String(asTpl.crs || c).toUpperCase(), tiplocs: [c], matchedAs: "tiploc" };
  }
  if (c.length === 3) return { crs: c, tiplocs: [], matchedAs: "crs" };
  return { crs: c, tiplocs: [c], matchedAs: "tiploc" };
}

function addLocationHit(seen, row) {
  const tiploc = String(row?.tiploc || "").toUpperCase();
  if (!tiploc || seen.has(tiploc)) return;
  const crs = String(row?.crs || "").toUpperCase();
  const name = String(row?.name || "").trim() || stationName(crs, tiploc) || tiploc;
  seen.set(tiploc, { tiploc, crs: crs.length === 3 ? crs : "", name });
}

function searchLocations(query) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const nameNeedle = raw.toUpperCase().replace(/[%_]/g, "").trim();
  const seen = new Map();
  if (compact) {
    const exactCorpus = catalog.prepare(`SELECT tiploc, crs, name FROM corpus WHERE tiploc = ?`).get(compact);
    const exactTpl = catalog.prepare(`SELECT tiploc, crs, name FROM tiploc WHERE tiploc = ?`).get(compact);
    addLocationHit(seen, exactCorpus);
    addLocationHit(seen, exactTpl);
    if (compact.length === 3) {
      for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM corpus WHERE crs = ?`).all(compact)) {
        addLocationHit(seen, row);
      }
      for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM tiploc WHERE crs = ?`).all(compact)) {
        addLocationHit(seen, row);
      }
    }
    const prefix = `${compact.replace(/[%_]/g, "")}%`;
    for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM corpus WHERE tiploc LIKE ? LIMIT 24`).all(prefix)) {
      addLocationHit(seen, row);
    }
    for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM tiploc WHERE tiploc LIKE ? LIMIT 24`).all(prefix)) {
      addLocationHit(seen, row);
    }
  }
  if (nameNeedle.length >= 2) {
    const like = `%${nameNeedle}%`;
    for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM corpus WHERE UPPER(name) LIKE ? LIMIT 24`).all(like)) {
      addLocationHit(seen, row);
    }
    for (const row of catalog.prepare(`SELECT tiploc, crs, name FROM tiploc WHERE UPPER(name) LIKE ? LIMIT 24`).all(like)) {
      addLocationHit(seen, row);
    }
  }
  const hits = [...seen.values()];
  const present = new Set(hits.map((hit) => hit.crs));
  const visible = hits.filter((hit) => {
    const group = stationCrsGroup(hit.crs);
    if (!group || group[0] === hit.crs) return true;
    if (compact === hit.crs) return true;
    return !present.has(group[0]);
  });
  return visible.slice(0, 20);
}

function lookupLocation(code) {
  const loc = resolveBoardLocation(code);
  const requested = String(code || "").toUpperCase();
  const tpl = loc.matchedAs === "tiploc" ? requested : loc.tiplocs[0] || requested;
  const name = stationName(loc.crs, tpl) || tpl;
  return {
    tiploc: tpl,
    crs: loc.crs.length === 3 ? loc.crs : "",
    name,
    matchedAs: loc.matchedAs,
  };
}

function emptyBoard(crs, hours, matchedAs = "crs") {
  const generatedAt = new Date().toISOString();
  const code = String(crs).toUpperCase();
  const station = stationName(code) || code;
  return {
    code,
    tiploc: code,
    crs: code,
    name: station,
    generatedAt,
    updatedAt: generatedAt,
    services: [],
    departures: [],
    arrivals: [],
    stationName: station,
    stationCrs: code,
    matchedAs,
    timetableFile: "",
    windowHours: hours,
    counts: { departures: 0, arrivals: 0, cancelled: 0, withDelay: 0, messages: 0 },
    messages: [],
    kafka: { consumed: 0, updatesApplied: 0, startedAt: generatedAt, lastMessageAt: generatedAt },
  };
}

async function liveDepartures(crs, opts) {
  const today = operatingDayYmd();
  const ymd = opts.ymd || today;
  const at = parseAtParam(opts.at);
  const cisMode = opts.passengersOnly === true;
  const hours = Math.max(1, Number(opts.hours) || 24);
  const loc = resolveBoardLocation(crs);
  const snapKey = `${String(crs).toUpperCase()}|${ymd}|${cisMode ? "cis" : "wtt"}|${hours}|${at || ""}`;
  const hit = boardSnap.get(snapKey);
  if (hit && Date.now() - hit.at < (ymd < today ? 3_600_000 : 4_000)) return hit.board;

  const days = locationBoardDays(ymd);
  for (const d of days) {
    if (d !== today) await ensureDayImported(d);
  }
  const historicalDate = ymd < today ? ymd : null;
  let now = londonNow();
  if (at) {
    const t = londonInstant(ymd, at);
    if (!Number.isNaN(t.getTime())) now = t;
  }
  let board = emptyBoard(loc.crs, hours, loc.matchedAs);
  for (const fileYmd of days) {
    const db = openDay(fileYmd);
    if (!db) continue;
    const part = buildStationBoard({
      db,
      ymd: fileYmd,
      crs: loc.crs,
      tiplocs: loc.tiplocs,
      hours,
      now,
      passengersOnly: cisMode,
      stationName,
      matchBy: loc.matchedAs,
      at,
      historicalDate,
      fullDay: Boolean(historicalDate) || hours >= 24,
      boardDate: ymd,
      cisMode,
      catalog,
    });
    board.departures = mergeBoardRows(board.departures, part.departures);
    board.arrivals = mergeBoardRows(board.arrivals, part.arrivals);
    if (part.stationName) board.stationName = part.stationName;
    board.name = part.name || board.name;
  }
  if (historicalDate) {
    const rids = [...new Set([...(board.departures || []), ...(board.arrivals || [])].map((row) => row.rid).filter(Boolean))];
    const holes = ridsNeedHsp(ymd, rids);
    board.hspPending = holes.length > 0;
    if (holes.length) startBoardHspFill(ymd, holes);
  } else {
    board.hspPending = false;
  }
  if (historicalDate) board.historicalDate = historicalDate;
  else board.historicalDate = ymd;
  if (at) board.historicalAt = at;
  board.windowHours = hours;
  board.matchedAs = loc.matchedAs;
  if (loc.matchedAs === "tiploc") board.tiploc = String(crs).toUpperCase();
  board.generatedAt = new Date().toISOString();
  board.updatedAt = board.generatedAt;
  boardSnap.set(snapKey, { at: Date.now(), board });
  if (boardSnap.size > 200) {
    const oldest = [...boardSnap.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < boardSnap.size - 200; i++) boardSnap.delete(oldest[i][0]);
  }
  return board;
}

function parseUnitCatalogJson(raw) {
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  if (parsed.json && typeof parsed.json === "object") parsed = { ...parsed, ...parsed.json };
  if (typeof parsed.vehicles_json === "string") {
    try {
      parsed.vehicles = JSON.parse(parsed.vehicles_json);
    } catch {
      /* keep string */
    }
  }
  return parsed;
}

function collapseCalls(rows) {
  const map = new Map();
  for (const c of rows) {
    const key = `${c.seq ?? "?"}|${c.tiploc}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...c });
      continue;
    }
    map.set(key, { ...prev, ...c, seq: prev.seq });
  }
  return [...map.values()].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

function trimCallsToDestination(rows, svc) {
  const destCrs = String(svc?.destination_crs || "").toUpperCase();
  const destTpl = String(svc?.destination || "").toUpperCase();
  const destName = String(svc?.destination_name || "").trim().toUpperCase();
  const ordered = collapseCalls(rows);
  if (!destCrs && destTpl.length < 3 && destName.length < 3) return ordered;
  let seenPublic = false;
  const destHits = [];
  const out = [];
  for (const c of ordered) {
    out.push(c);
    const pass = Boolean(Number(c.is_passing)) || Boolean(c.wtp && !c.sta && !c.std);
    if (pass) continue;
    seenPublic = true;
    const crs = String(c.crs || "").toUpperCase();
    const tpl = String(c.tiploc || "").toUpperCase();
    const name = String(stationName(crs, tpl) || "").trim().toUpperCase();
    if (seenPublic && destCrs && crs === destCrs) destHits.push(out.length - 1);
    if (seenPublic && destTpl && tpl === destTpl) destHits.push(out.length - 1);
    if (seenPublic && destName && (name === destName || tpl === destName)) destHits.push(out.length - 1);
  }
  if (!destHits.length) return out.length ? out : ordered;
  const cut = destHits[destHits.length - 1];
  const laterAdvertised = out.slice(cut + 1).some((c) => {
    const pass = Boolean(Number(c.is_passing)) || Boolean(c.wtp && !c.sta && !c.std);
    if (pass) return false;
    return Boolean(String(c.crs || "").trim()) && Boolean(c.sta || c.std);
  });
  if (laterAdvertised) return out;
  return out.slice(0, cut + 1);
}

function parseCoachLoading(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed
      .filter((item) => item && item.number != null && Number.isFinite(Number(item.value)))
      .map((item) => ({ number: String(item.number), value: Number(item.value) }));
  } catch {
    return null;
  }
}

function storedFormation(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.coaches) || !parsed.coaches.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function consistForService(ymd, svc) {
  const days = [ymd, addCalendarDays(ymd, 1), addCalendarDays(ymd, -1)].filter(Boolean);
  const seen = new Set();
  for (const day of days) {
    if (seen.has(day)) continue;
    seen.add(day);
    const row = lookupConsist(catalog, { uid: svc.uid, ssd: day, headcode: svc.headcode });
    const doc = consistDocument(row, svc.toc);
    if (doc) return doc;
  }
  return null;
}

function ridYmd(rid) {
  const s = String(rid || "");
  if (!/^\d{8}/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function dayHasRid(ymd, rid) {
  const db = openDay(ymd);
  if (!db) return false;
  return Boolean(db.prepare(`SELECT 1 AS n FROM services WHERE rid = ?`).get(rid));
}

function mergeBoardRows(a, b) {
  const map = new Map();
  for (const row of [...(a || []), ...(b || [])]) {
    const key = `${row.rid}|${row.scheduledTime || ""}|${row.movement || ""}`;
    const prev = map.get(key);
    if (!prev) map.set(key, row);
    else if ((row.liveKind || "").startsWith("actual") && !(prev.liveKind || "").startsWith("actual")) map.set(key, row);
  }
  return collapseDuplicateBoardRows([...map.values()]);
}

function isLiveServiceDay(ymd) {
  const op = operatingDayYmd();
  return ymd === op || ymd === addCalendarDays(op, -1) || ymd === addCalendarDays(op, 1);
}

function findService(db, id, ymd) {
  const s = String(id || "");
  if (!s || !db) return null;
  const byRid = db.prepare(`SELECT * FROM services WHERE rid = ?`).get(s);
  if (byRid) return byRid;
  const uid = s.toUpperCase();
  const rows = db.prepare(`SELECT * FROM services WHERE UPPER(IFNULL(uid,'')) = ?`).all(uid);
  if (!rows.length) return null;
  const compact = String(ymd || "").replace(/-/g, "");
  const dated = compact ? rows.find((r) => String(r.rid || "").startsWith(compact)) : null;
  if (dated) return dated;
  const leftover = rows[0];
  if (compact && leftover) {
    const sameWorking = db
      .prepare(
        `SELECT * FROM services
         WHERE rid LIKE ?
           AND IFNULL(headcode, train_id) = ?
           AND IFNULL(origin_crs,'') = IFNULL(?, '')
         LIMIT 1`,
      )
      .get(`${compact}%`, leftover.headcode || leftover.train_id, leftover.origin_crs);
    if (sameWorking) return sameWorking;
  }
  return leftover;
}

function ridLiveScore(ymd, id) {
  const db = openDay(ymd);
  if (!db) return -1;
  const svc = findService(db, id, ymd);
  if (!svc) return -1;
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM calls
       WHERE rid = ? AND (ata IS NOT NULL OR atd IS NOT NULL OR eta IS NOT NULL OR etd IS NOT NULL)`,
    )
    .get(svc.rid).n;
}

function resolveServiceYmd(id, dateParam) {
  const fromRid = /^\d{8}/.test(String(id)) ? ssdFromRid(id) || ridYmd(id) : null;
  if (fromRid && dayHasRid(fromRid, id)) return fromRid;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam || "")) {
    if (dayHasRid(dateParam, id)) return dateParam;
    const nearby = lookupServiceAnyDay(id, dateParam);
    if (nearby) return nearby.day;
    return dateParam;
  }
  const today = operatingDayYmd();
  const candidates = [today, addCalendarDays(today, -1), fromRid, addCalendarDays(today, 1)];
  let best = null;
  let bestScore = -1;
  const seen = new Set();
  for (const y of candidates) {
    if (!y || seen.has(y)) continue;
    seen.add(y);
    const score = ridLiveScore(y, id);
    if (score > bestScore) {
      bestScore = score;
      best = y;
    }
  }
  if (best && bestScore >= 0) return best;
  return fromRid || today;
}

function serviceHspPending(db, ymd, rid) {
  if (isLiveServiceDay(ymd)) return false;
  if (!ridNeedsHsp(db, rid)) return false;
  if (ymd > operatingDayYmd()) return false;
  return true;
}

function lookupServiceAnyDay(id, ymd) {
  const days = [ymd, addCalendarDays(ymd, 1), addCalendarDays(ymd, -1)];
  for (const day of days) {
    const db = openDay(day);
    if (!db) continue;
    const svc = findService(db, id, day);
    if (svc) return { db, day, svc };
  }
  return null;
}

function publicEndName(db, svc) {
  const rows = sortCallsByJourneyTime(
    db.prepare(`SELECT * FROM calls WHERE rid = ? AND IFNULL(is_passing,0)=0`).all(svc.rid),
  );
  const last = rows[rows.length - 1];
  const first = rows[0];
  return {
    origin: stationName(first?.crs, first?.tiploc) || svc.origin_name,
    dest: stationName(last?.crs, last?.tiploc) || svc.destination_name,
  };
}

function gatherServiceCalls(ymd, svc) {
  const db = openDay(ymd);
  if (!db) return [];
  const rows = db.prepare(`SELECT * FROM calls WHERE rid = ?`).all(svc.rid);
  for (const day of [addCalendarDays(ymd, -1), addCalendarDays(ymd, 1)]) {
    const other = openDay(day);
    if (!other) continue;
    const extra = other.prepare(`SELECT * FROM calls WHERE rid = ?`).all(svc.rid);
    const seen = new Set(rows.map((c) => `${String(c.tiploc || "").toUpperCase()}|${c.seq ?? ""}`));
    for (const c of extra) {
      const key = `${String(c.tiploc || "").toUpperCase()}|${c.seq ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(c);
    }
  }
  return collapseCallsByTiploc(rows);
}

function concatCallsAtTpl(first, second, tpl) {
  const t = String(tpl || "").toUpperCase();
  if (!t || !second.length) return first;
  let cut = -1;
  for (let i = 0; i < first.length; i++) {
    if (String(first[i].tiploc || "").toUpperCase() === t) cut = i;
  }
  const head = cut >= 0 ? first.slice(0, cut + 1) : first;
  let start = 0;
  for (let i = 0; i < second.length; i++) {
    if (String(second[i].tiploc || "").toUpperCase() === t) start = i + 1;
  }
  return sortCallsByJourneyTime([...head, ...second.slice(start)]);
}

function hydrateAssociations(ymd, associations) {
  return (associations || []).map((a) => {
    const hit = lookupServiceAnyDay(a.otherRid || a.otherUid, ymd);
    if (!hit) return a;
    const ends = publicEndName(hit.db, hit.svc);
    return {
      ...a,
      otherRid: hit.svc.rid,
      otherUid: hit.svc.uid || a.otherUid,
      otherTrainId: hit.svc.headcode || hit.svc.train_id || a.otherTrainId,
      otherDestinationName: ends.dest || a.otherDestinationName,
      otherOriginName: ends.origin || a.otherOriginName,
    };
  });
}

function adjacentServiceDatabases(ymd) {
  return [addCalendarDays(ymd, -1), ymd, addCalendarDays(ymd, 1)]
    .filter(Boolean)
    .map((day) => ({ ymd: day, db: openDay(day) }))
    .filter((row) => row.db);
}

async function serviceDetail(ymd, rid, atRaw) {
  const at = parseAtParam(atRaw);
  for (const day of [ymd, addCalendarDays(ymd, -1), addCalendarDays(ymd, 1)]) {
    if (day && day !== londonCalendarYmd()) await ensureDayImported(day);
  }
  let db = openDay(ymd);
  if (!db) return null;
  let svc = findService(db, rid, ymd);
  if (!svc) {
    const hit = lookupServiceAnyDay(rid, ymd);
    if (!hit) return null;
    ymd = hit.day;
    db = hit.db;
    svc = hit.svc;
  }
  const resolvedRid = svc.rid;
  let rawCalls = gatherServiceCalls(ymd, svc);
  let storedAssoc = hydrateAssociations(ymd, associationsForRid(db, resolvedRid, stationName));
  const consist = consistForService(ymd, svc);
  const consistInferred = inferAssociationsFromConsist({ db, catalog, ymd, svc, consist, stationName });
  const inferredAssoc = hydrateAssociations(
    ymd,
    mergeAssociations(
      consistInferred,
      inferScheduleDivides({ db, svc, stationName, ymd, databases: adjacentServiceDatabases(ymd) }),
    ),
  );
  const journeyTpls = rawCalls.filter((c) => !Number(c.is_passing)).map((c) => c.tiploc);
  let associations = filterDisplayAssociations(
    collapseOvernightAssociates(
      mergeAssociations(storedAssoc, inferredAssoc),
      ssdFromRid(resolvedRid) || ymd,
    ),
    svc.toc,
    journeyTpls,
  );
  persistInferred(db, resolvedRid, []);
  const seenPortions = new Set([resolvedRid, svc.uid].filter(Boolean).map((v) => String(v).toUpperCase()));
  for (const a of associations) {
    if (a.category !== "NP" || a.isDeleted) continue;
    const otherId = a.otherUid || a.otherRid;
    if (!otherId || seenPortions.has(String(otherId).toUpperCase())) continue;
    const hit = lookupServiceAnyDay(otherId, ymd);
    if (!hit) continue;
    seenPortions.add(hit.svc.rid.toUpperCase());
    if (hit.svc.uid) seenPortions.add(String(hit.svc.uid).toUpperCase());
    const otherCalls = gatherServiceCalls(hit.day, hit.svc);
    rawCalls = a.role === "main"
      ? concatCallsAtTpl(rawCalls, otherCalls, a.tiploc)
      : concatCallsAtTpl(otherCalls, rawCalls, a.tiploc);
    associations = filterDisplayAssociations(
      collapseOvernightAssociates(
        mergeAssociations(
          associations,
          hydrateAssociations(hit.day, associationsForRid(hit.db, hit.svc.rid, stationName)),
        ),
        ssdFromRid(resolvedRid) || ymd,
      ),
      svc.toc,
      journeyTpls,
    );
  }
  const calls = maskCallsAsOf(trimCallsToDestination(sortCallsByJourneyTime(rawCalls), svc), at);
  const units = Array.isArray(consist?.allocations)
    ? [...new Set(consist.allocations.flatMap((a) => (a.resourceGroups || []).map((g) => g.unitId).filter(Boolean)))]
    : [];
  const callingPoints = calls.map((c) => ({
      crs: c.crs,
      tiploc: c.tiploc,
      seq: c.seq,
      isPassing:
        Boolean(Number(c.is_passing)) ||
        Boolean(c.wtp && !c.sta && !c.std),
      platform: platformText(c.platform),
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
  const passengerIdx = callingPoints
    .map((c, i) => (c.isPassing ? -1 : i))
    .filter((i) => i >= 0);
  const firstPax = passengerIdx[0] ?? 0;
  const lastPax = passengerIdx[passengerIdx.length - 1] ?? callingPoints.length - 1;
  const stops = callingPoints.map((c, i) => ({
    tpl: c.tiploc,
    name: stationName(c.crs, c.tiploc),
    crs: c.crs,
    slot: c.isPassing ? "PP" : i === firstPax ? "OR" : i === lastPax ? "DT" : "IP",
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
    liveTime: c.isPassing
      ? c.atp || c.etp || c.wtp
      : c.atd || c.ata || c.atp || c.etd || c.eta || c.etp || c.std || c.sta || c.wtp,
    liveKind: liveClockFromCall(c, c.isPassing ? "departure" : i === lastPax ? "arrival" : "departure").kind || c.liveKind,
    cancelledAtStop: false,
    cancelReasonAtStop: null,
    loadingPercentage: c.loading_percentage ?? null,
    coachLoading: parseCoachLoading(c.coach_loading),
    actualSource: c.actualSource,
  }));
  const hspPending = serviceHspPending(db, ymd, resolvedRid);
  if (hspPending) startBoardHspFill(ymd, [resolvedRid]);
  const originStop = stops.find((s) => s.slot === "OR") || stops.find((s) => s.crs && s.slot !== "PP");
  const destStop = [...stops].reverse().find((s) => s.slot === "DT") || [...stops].reverse().find((s) => s.crs && s.slot !== "PP");
  const location = computeServiceLocation(calls, { stationName, ymd, now: at ? londonInstant(ymd, at) || new Date() : new Date() });
  const ownDest = destStop?.name || stationName(destStop?.crs, destStop?.tpl) || svc.destination_name;
  return {
    rid: svc.rid,
    uid: svc.uid,
    trainId: svc.headcode,
    ssd: ymd,
    toc: svc.toc,
    tocName: tocDisplayName(svc.toc) || svc.operator_name,
    trainCat: svc.category,
    isPassenger: svc.service_type !== "freight",
    origin: originStop?.crs || svc.origin_crs || "",
    originName: originStop?.name || stationName(originStop?.crs, originStop?.tpl) || svc.origin_name,
    destination: destStop?.crs || svc.destination_crs || "",
    destinationName: combinedDestinationName(ownDest, associations, svc.toc, journeyTpls),
    cancelled: Boolean(svc.cancelled),
    cancellation: null,
    partiallyCancelled: false,
    delayReason: svc.delay_reason || null,
    reverseFormation: false,
    formation: storedFormation(svc.formation),
    consist,
    associations,
    alerts: [],
    units,
    stops,
    serviceType: svc.service_type,
    updatedAt: new Date().toISOString(),
    historicalDate: isLiveServiceDay(ymd) ? null : ymd,
    historicalAt: at,
    location,
    hspPending,
  };
}

function fleetIdOf(unitId, cls) {
  const fromClass = String(cls || "").match(/\d{3}/)?.[0];
  if (fromClass) return fromClass;
  return String(unitId || "").match(/^(\d{3})/)?.[1] || "other";
}

function catalogFleetId(row) {
  const inner = parseUnitCatalogJson(row?.json);
  return inner.fleetId || inner.fleet_id || row?.class || fleetIdOf(row?.unit_id, row?.class);
}

function listUnitDays() {
  return catalog
    .prepare(`SELECT DISTINCT ssd FROM consists ORDER BY ssd DESC`)
    .all()
    .map((r) => r.ssd);
}

function unitIdsOnDay(ymd) {
  const ids = new Set();
  for (const row of catalog.prepare(`SELECT unit_ids FROM consists WHERE ssd = ?`).all(ymd)) {
    for (const id of unitIdsFromConsistRow(row)) ids.add(id);
  }
  return ids;
}

function listUnitFleets(day) {
  const filterIds = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? unitIdsOnDay(day) : null;
  const counts = new Map();
  const rows = catalog.prepare(`SELECT unit_id, class, json FROM units`).all();
  for (const row of rows) {
    if (filterIds && !filterIds.has(String(row.unit_id))) continue;
    const fleetId = catalogFleetId(row) || "Unknown";
    counts.set(fleetId, (counts.get(fleetId) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([fleetId, unitCount]) => ({ fleetId, unitCount }))
    .sort((a, b) => a.fleetId.localeCompare(b.fleetId));
}

function listUnitCatalog(params) {
  const fleet = String(params.get("fleet") || "").trim();
  const q = String(params.get("q") || "").trim().toUpperCase();
  const day = params.get("day");
  const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 100)));
  const cursor = Math.max(0, Number(params.get("cursor") || 0));
  const filterIds = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? unitIdsOnDay(day) : null;
  const milesByUnit = new Map();
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      for (const row of catalog.prepare(`SELECT unit_ids FROM consists WHERE ssd = ?`).all(day)) {
        for (const id of unitIdsFromConsistRow(row)) {
          const cur = milesByUnit.get(id) || { serviceCount: 0 };
          cur.serviceCount += 1;
          milesByUnit.set(id, cur);
        }
      }
  }
  const rows = catalog.prepare(`SELECT unit_id, class, json FROM units ORDER BY unit_id`).all();
  const units = [];
  for (const row of rows) {
    const unitId = String(row.unit_id);
    if (filterIds && !filterIds.has(unitId)) continue;
    if (q && !unitId.toUpperCase().includes(q)) continue;
    const fleetId = catalogFleetId(row);
    if (fleet && String(fleetId) !== fleet && !String(fleetId).startsWith(fleet)) continue;
    const inner = parseUnitCatalogJson(row.json);
    units.push({
      unitId,
      fleetId,
      serviceCount: milesByUnit.get(unitId)?.serviceCount || 0,
      lastEndOfDayMiles: inner.last_end_of_day_miles ?? inner.lastEndOfDayMiles ?? null,
    });
  }
  const slice = units.slice(cursor, cursor + limit);
  return { units: slice, total: units.length, nextCursor: cursor + slice.length < units.length ? cursor + slice.length : null };
}

async function unitDetail(unitId, dateRaw) {
  const id = String(unitId || "").trim();
  if (!id) return null;
  const cat = catalog.prepare(`SELECT unit_id, class, json, updated_at FROM units WHERE unit_id = ?`).get(id);
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw || "") ? dateRaw : londonCalendarYmd();
  const services = [];
  let lastSeenRid = null;
  const consistRows = catalog
    .prepare(`SELECT uid, ssd, headcode, unit_ids FROM consists WHERE unit_ids LIKE ? ORDER BY ssd DESC LIMIT 40`)
    .all(`%${id}%`);
  for (const row of consistRows) {
    if (!unitIdsFromConsistRow(row).includes(id)) continue;
    const db = openDay(row.ssd);
    if (!db) continue;
    const svc = db.prepare(`SELECT rid, headcode, origin_name, destination_name, origin_crs, destination_crs FROM services WHERE UPPER(IFNULL(uid,'')) = ? LIMIT 1`).get(String(row.uid).toUpperCase());
    if (!svc) continue;
    lastSeenRid = svc.rid;
    services.push({
      rid: svc.rid,
      headcode: svc.headcode || row.headcode || null,
      start: row.ssd,
      end: row.ssd,
      startTpl: null,
      endTpl: null,
      startName: svc.origin_name || svc.origin_crs || null,
      endName: svc.destination_name || svc.destination_crs || null,
      position: null,
      reversed: false,
    });
  }
  if (!cat && !services.length) return null;
  const inner = parseUnitCatalogJson(cat?.json);
  let vehiclesRaw = inner.vehicles || inner.Vehicles || [];
  if (typeof inner.vehicles_json === "string") {
    try {
      vehiclesRaw = JSON.parse(inner.vehicles_json);
    } catch {
      /* keep */
    }
  }
  let latestService = null;
  if (lastSeenRid) {
    const ridDay = ridYmd(lastSeenRid) || ymd;
    latestService = await serviceDetail(ridDay, lastSeenRid, null);
  }
  return {
    unitId: id,
    fleetId: catalogFleetId(cat || { unit_id: id, class: inner.fleetId, json: cat?.json }),
    vehicles: normalizePtacVehicles(vehiclesRaw),
    lastSeenRid,
    lastEndOfDayMiles: inner.last_end_of_day_miles ?? inner.lastEndOfDayMiles ?? null,
    updatedAt: cat?.updated_at ? new Date(cat.updated_at).toISOString() : new Date().toISOString(),
    latestService,
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
    const open = url.pathname === "/api/ping" || url.pathname === "/health";
    if (!open) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
  }

  try {
    if (url.pathname === "/health" || url.pathname === "/api/health" || url.pathname === "/api/ping") {
      json(res, 200, { ok: true, role: "query", day: operatingDayYmd(), days: listDayYmds() });
      return;
    }
    if (url.pathname === "/api/locations" || url.pathname === "/api/station") {
      json(res, 200, { locations: searchLocations(url.searchParams.get("q") || "") }, {
        "cache-control": "public, max-age=60, s-maxage=60",
      });
      return;
    }
    const locOne = url.pathname.match(/^\/api\/(?:locations|station)\/([A-Z0-9]{3,10})$/i);
    if (locOne) {
      json(res, 200, lookupLocation(locOne[1]), {
        "cache-control": "public, max-age=300, s-maxage=300",
      });
      return;
    }
    const dep = url.pathname.match(/^\/api\/departures\/([A-Z0-9]{3,10})$/i);
    if (dep) {
      const date = url.searchParams.get("date");
      const ymd = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : operatingDayYmd();
      const cis = url.searchParams.get("passengers") === "1" || url.searchParams.get("cis") === "1";
      const hours = Math.max(1, Math.min(24, Number(url.searchParams.get("hours") || 24) || 24));
      const board = await liveDepartures(dep[1], {
        passengersOnly: cis,
        hours,
        ymd,
        at: url.searchParams.get("at"),
      });
      const past = ymd < operatingDayYmd();
      json(res, 200, board, {
        "cache-control": past ? "public, max-age=3600, s-maxage=3600" : "public, max-age=3, s-maxage=3",
      });
      return;
    }
    const svcDated = url.pathname.match(/^\/api\/service\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
    if (svcDated) {
      const detail = await serviceDetail(svcDated[2], decodeURIComponent(svcDated[1]), url.searchParams.get("at"));
      if (!detail) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, detail, { "cache-control": "public, max-age=60" });
      return;
    }
    const svcRid = url.pathname.match(/^\/api\/service\/([^/]+)$/);
    if (svcRid) {
      const rid = decodeURIComponent(svcRid[1]);
      const ymd = resolveServiceYmd(rid, url.searchParams.get("date"));
      const detail = await serviceDetail(ymd, rid, url.searchParams.get("at"));
      if (!detail) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, detail, { "cache-control": "public, max-age=5" });
      return;
    }
    const trustTrain = url.pathname.match(/^\/api\/trust\/([^/]+)$/i);
    if (trustTrain) {
      const date = url.searchParams.get("date");
      const ymd = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : londonCalendarYmd();
      const db = openDay(ymd);
      if (!db) {
        json(res, 404, { error: "not found" });
        return;
      }
      const trainId = decodeURIComponent(trustTrain[1]);
      const events = db
        .prepare(`SELECT event_id, train_id, uid, loc_stanox, event_type, planned, actual, json, received_at FROM trust_events WHERE train_id = ? ORDER BY received_at`)
        .all(trainId)
        .map((e) => {
          let parsed = e.json;
          try {
            parsed = e.json ? JSON.parse(e.json) : null;
          } catch {
            parsed = e.json;
          }
          return { ...e, json: parsed };
        });
      json(res, 200, { trainId, date: ymd, events });
      return;
    }
    if (url.pathname === "/api/window" || url.pathname === "/api/dates" || url.pathname === "/api/history/dates") {
      const days = listDayYmds();
      const today = londonCalendarYmd();
      const horizon = timetableHorizonYmd();
      const maxFile = days.at(-1) || today;
      json(res, 200, {
        timetableWindow: { minDate: days[0] || today, maxDate: maxFile > horizon ? maxFile : horizon },
        dates: days,
      });
      return;
    }
    if (url.pathname === "/api/units/days") {
      json(res, 200, { days: listUnitDays() }, { "cache-control": "public, max-age=30" });
      return;
    }
    if (url.pathname === "/api/units/fleets") {
      json(res, 200, { fleets: listUnitFleets(url.searchParams.get("day")) }, { "cache-control": "public, max-age=30" });
      return;
    }
    if (url.pathname === "/api/units/catalog") {
      json(res, 200, listUnitCatalog(url.searchParams), { "cache-control": "public, max-age=15" });
      return;
    }
    const unitOne = url.pathname.match(/^\/api\/unit\/([^/]+)$/i);
    if (unitOne) {
      const detail = await unitDetail(decodeURIComponent(unitOne[1]), url.searchParams.get("date"));
      if (!detail) {
        json(res, 404, { error: "not found" });
        return;
      }
      json(res, 200, detail, { "cache-control": "public, max-age=5" });
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
