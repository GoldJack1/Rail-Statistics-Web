import { unitIdsFromConsistRow } from "./ptac-apply.js";
import { addCalendarDays, ssdFromRid } from "./calendar-day.js";
import { isPassengerHeadcode } from "./headcode.js";

export function ensureAssociationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS associations (
      main_rid TEXT NOT NULL,
      assoc_rid TEXT NOT NULL,
      category TEXT NOT NULL,
      tiploc TEXT NOT NULL DEFAULT '',
      main_uid TEXT,
      assoc_uid TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (main_rid, assoc_rid, category, tiploc)
    );
    CREATE INDEX IF NOT EXISTS idx_assoc_main ON associations (main_rid);
    CREATE INDEX IF NOT EXISTS idx_assoc_assoc ON associations (assoc_rid);
  `);
}

export function upsertAssociation(db, row) {
  if (!db || !row?.main_rid || !row?.assoc_rid || !row?.category) return;
  ensureAssociationsTable(db);
  db.prepare(
    `INSERT INTO associations (main_rid, assoc_rid, category, tiploc, main_uid, assoc_uid, is_cancelled, is_deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(main_rid, assoc_rid, category, tiploc) DO UPDATE SET
       main_uid=COALESCE(excluded.main_uid, associations.main_uid),
       assoc_uid=COALESCE(excluded.assoc_uid, associations.assoc_uid),
       is_cancelled=excluded.is_cancelled,
       is_deleted=excluded.is_deleted,
       updated_at=excluded.updated_at`,
  ).run(
    row.main_rid,
    row.assoc_rid,
    String(row.category).toUpperCase(),
    String(row.tiploc || "").toUpperCase(),
    row.main_uid || null,
    row.assoc_uid || null,
    row.is_cancelled ? 1 : 0,
    row.is_deleted ? 1 : 0,
    row.updated_at || Date.now(),
  );
}

/** CIF AA record. Fields are 1-based inclusive per the Network Rail CIF spec. */
export function parseCifAa(line, ymd, ridForUid) {
  if (!line || line.slice(0, 2) !== "AA") return null;
  const mainUid = line.slice(2, 8).trim();
  const assocUid = line.slice(8, 14).trim();
  const category = line.slice(35, 37).trim().toUpperCase();
  const tiploc = line.slice(38, 45).trim().toUpperCase();
  if (!mainUid || !assocUid || !["VV", "JJ", "NP"].includes(category)) return null;
  const start = cifDate(line.slice(14, 21));
  const end = cifDate(line.slice(21, 28));
  if (ymd && start && ymd < start) return null;
  if (ymd && end && ymd > end) return null;
  const mainRid = ridForUid?.(mainUid) || null;
  const assocRid = ridForUid?.(assocUid) || null;
  if (!mainRid || !assocRid) return null;
  return {
    main_rid: mainRid,
    assoc_rid: assocRid,
    category,
    tiploc,
    main_uid: mainUid,
    assoc_uid: assocUid,
    is_cancelled: 0,
    is_deleted: 0,
    updated_at: Date.now(),
  };
}

function cifDate(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 6) return null;
  const yy = Number(s.slice(0, 2));
  const year = yy >= 60 ? 1900 + yy : 2000 + yy;
  return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

export function extractDarwinAssociationsXml(xml) {
  const out = [];
  const blockRe = /<(?:[\w-]+:)?Association\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Association>/gi;
  let m;
  while ((m = blockRe.exec(String(xml || "")))) {
    const attrs = m[1] || "";
    const inner = m[2] || "";
    const category = (attrs.match(/\bcategory="([^"]+)"/i)?.[1] || inner.match(/\bcategory="([^"]+)"/i)?.[1] || "").toUpperCase();
    const tiploc = (attrs.match(/\btiploc="([^"]+)"/i)?.[1] || attrs.match(/\btpl="([^"]+)"/i)?.[1] || "").toUpperCase();
    const cancelled = /isCancelled="true"/i.test(attrs) || /isCancelled="true"/i.test(inner);
    const deleted = /isDeleted="true"/i.test(attrs) || /isDeleted="true"/i.test(inner);
    const main = serviceAttrs(inner, "main");
    const assoc = serviceAttrs(inner, "assoc");
    if (!main.rid || !assoc.rid || !["VV", "JJ", "NP"].includes(category)) continue;
    out.push({
      main_rid: main.rid,
      assoc_rid: assoc.rid,
      category,
      tiploc,
      main_uid: main.uid,
      assoc_uid: assoc.uid,
      is_cancelled: cancelled ? 1 : 0,
      is_deleted: deleted ? 1 : 0,
      updated_at: Date.now(),
    });
  }
  return out;
}

function serviceAttrs(inner, tag) {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)\\/?>`, "i");
  const hit = inner.match(re);
  const attrs = hit?.[1] || "";
  return {
    rid: attrs.match(/\brid="([^"]+)"/i)?.[1] || null,
    uid: attrs.match(/\buid="([^"]+)"/i)?.[1] || null,
    trainId: attrs.match(/\btrainId="([^"]+)"/i)?.[1] || null,
  };
}

export function extractDarwinAssociationsJson(obj, out = []) {
  if (!obj || typeof obj !== "object") return out;
  const nodes = Array.isArray(obj) ? obj : [obj];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const category = String(node.category || node.Category || "").toUpperCase();
    const main = node.main || node.Main;
    const assoc = node.assoc || node.Assoc || node.associated;
    const mainRid = main?.rid || main?.RID;
    const assocRid = assoc?.rid || assoc?.RID;
    if (mainRid && assocRid && ["VV", "JJ", "NP"].includes(category)) {
      out.push({
        main_rid: String(mainRid),
        assoc_rid: String(assocRid),
        category,
        tiploc: String(node.tiploc || node.tpl || node.Tiploc || "").toUpperCase(),
        main_uid: main.uid || main.UID || null,
        assoc_uid: assoc.uid || assoc.UID || null,
        is_cancelled: node.isCancelled === true || node.isCancelled === "true" ? 1 : 0,
        is_deleted: node.isDeleted === true || node.isDeleted === "true" ? 1 : 0,
        updated_at: Date.now(),
      });
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") extractDarwinAssociationsJson(v, out);
    }
  }
  return out;
}

function clockMinutes(raw) {
  const m = String(raw || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesApart(a, b) {
  if (a == null || b == null) return 24 * 60;
  let d = Math.abs(a - b);
  if (d > 12 * 60) d = 24 * 60 - d;
  return d;
}

function parseConsistJson(row) {
  if (!row) return null;
  if (row.json && typeof row.json === "object") return row.json;
  try {
    return row.json ? JSON.parse(row.json) : null;
  } catch {
    return null;
  }
}

function unitEnds(consist) {
  const first = new Map();
  const last = new Map();
  for (const a of consist?.allocations || []) {
    const orig = String(a.allocationOrigin?.tiploc || a.trainOrigin?.tiploc || "").toUpperCase();
    const dest = String(a.allocationDestination?.tiploc || a.trainDest?.tiploc || "").toUpperCase();
    const oDt = a.allocationOriginDateTime || a.trainOriginDateTime;
    const dDt = a.allocationDestinationDateTime || a.trainDestDateTime;
    for (const g of a.resourceGroups || []) {
      const id = String(g.unitId || "");
      if (!id) continue;
      if (!first.has(id)) first.set(id, { tpl: orig, minutes: clockMinutes(oDt) });
      last.set(id, { tpl: dest, minutes: clockMinutes(dDt) });
    }
  }
  const trainDest = String(consist?.allocations?.[0]?.trainDest?.tiploc || "").toUpperCase();
  const trainOrig = String(consist?.allocations?.[0]?.trainOrigin?.tiploc || "").toUpperCase();
  return { first, last, trainDest, trainOrig };
}

function lookupServiceByUid(db, uid) {
  if (!db || !uid) return null;
  return db.prepare(`SELECT * FROM services WHERE UPPER(IFNULL(uid,'')) = ? LIMIT 1`).get(String(uid).toUpperCase());
}

function passengerCalls(db, rid) {
  const rows = db
    .prepare(
      `SELECT * FROM calls WHERE rid = ? AND IFNULL(is_passing,0)=0
         AND (IFNULL(crs,'') != '' OR sta IS NOT NULL OR std IS NOT NULL OR wta IS NOT NULL OR wtd IS NOT NULL)
       ORDER BY seq ASC`,
    )
    .all(rid);
  let lastPub = -1;
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    if (c.crs || c.sta || c.std) lastPub = i;
  }
  return lastPub >= 0 ? rows.slice(0, lastPub + 1) : rows;
}

function callClockFromRow(c) {
  return clockMinutes(c?.std || c?.wtd || c?.sta || c?.wta || c?.wtp);
}

function associationPayload(svc, other, tpl, stationName, role = "main", category = "VV") {
  return {
    category,
    tiploc: tpl,
    tiplocName: stationName?.(null, tpl) || tpl,
    tiplocCrs: null,
    mainRid: role === "main" ? svc.rid : other.rid,
    assocRid: role === "main" ? other.rid : svc.rid,
    role,
    otherRid: other.rid,
    otherUid: other.uid || null,
    otherTrainId: other.headcode || other.train_id || null,
    otherToc: other.toc || null,
    otherOriginName: originOfService(null, other, stationName),
    otherDestinationName: destOfService(null, other, stationName),
    mainTime: null,
    assocTime: null,
    isCancelled: Boolean(other.cancelled),
    isDeleted: false,
  };
}

function serviceSsd(svc, fallbackYmd) {
  return ssdFromRid(svc?.rid) || fallbackYmd || null;
}

function isOvernightPassenger(calls) {
  if (!calls || calls.length < 2) return false;
  const first = callClockFromRow(calls[0]);
  const last = callClockFromRow(calls[calls.length - 1]);
  return first != null && last != null && first >= 18 * 60 && last < 12 * 60;
}

function eventYmd(ssd, clockMins, overnight) {
  if (!ssd || clockMins == null) return ssd;
  if (overnight && clockMins < 12 * 60) return addCalendarDays(ssd, 1);
  if (clockMins < 2 * 60) return addCalendarDays(ssd, 1);
  return ssd;
}

function listCsWorkings(databases) {
  const out = [];
  const seen = new Set();
  for (const { ymd, db } of databases || []) {
    if (!db) continue;
    const rows = db
      .prepare(
        `SELECT * FROM services WHERE UPPER(IFNULL(toc,'')) = 'CS' AND IFNULL(cancelled,0)=0`,
      )
      .all();
    for (const svc of rows) {
      if (seen.has(svc.rid)) continue;
      seen.add(svc.rid);
      const head = String(svc.headcode || svc.train_id || "");
      if (head && !isPassengerHeadcode(head)) continue;
      const calls = passengerCalls(db, svc.rid);
      if (calls.length < 2) continue;
      out.push({ db, ymd, svc, calls, ssd: serviceSsd(svc, ymd) });
    }
  }
  return out;
}

function pushDivide(out, seen, main, portion, tpl, stationName, role, category = "VV") {
  const key = `${main.svc.rid}|${portion.svc.rid}|${tpl}|${role}|${category}`;
  if (seen.has(key)) return;
  seen.add(key);
  const oCalls = role === "main" ? portion.calls : main.calls;
  const other = role === "main" ? portion.svc : main.svc;
  const row = associationPayload(main.svc, other, tpl, stationName, role, category);
  if (role === "associated") {
    row.mainRid = main.svc.rid;
    row.assocRid = portion.svc.rid;
    row.otherRid = main.svc.rid;
    row.otherUid = main.svc.uid;
    row.otherTrainId = main.svc.headcode || main.svc.train_id;
    row.otherOriginName = stationName?.(main.calls[0].crs, main.calls[0].tiploc) || main.svc.origin_name;
    row.otherDestinationName =
      stationName?.(main.calls[main.calls.length - 1].crs, main.calls[main.calls.length - 1].tiploc) ||
      main.svc.destination_name;
  } else {
    row.otherOriginName = stationName?.(oCalls[0].crs, oCalls[0].tiploc) || other.origin_name;
    row.otherDestinationName =
      stationName?.(oCalls[oCalls.length - 1].crs, oCalls[oCalls.length - 1].tiploc) || other.destination_name;
  }
  out.push(row);
}

/**
 * CIF/Darwin often omit sleeper/portion divides. Recover them when another
 * same-TOC passenger train starts at an intermediate call. Edinburgh CS splits
 * are after 02:00, so portions live on the next railway day from the main origin.
 */
export function inferScheduleDivides({ db, svc, stationName, ymd = null, databases = null }) {
  if (!svc?.rid) return [];
  const toc = String(svc.toc || "").toUpperCase();
  if (toc !== "CS") return [];
  const dbs = databases?.length ? databases : db ? [{ ymd, db }] : [];
  const workings = listCsWorkings(dbs);
  const mine = workings.find((w) => w.svc.rid === svc.rid);
  if (!mine || mine.calls.length < 2) return [];
  const origTpl = String(mine.calls[0].tiploc || "").toUpperCase();
  const destTpl = String(mine.calls[mine.calls.length - 1].tiploc || "").toUpperCase();
  const mineOvernight = isOvernightPassenger(mine.calls);
  const out = [];
  const seen = new Set();

  const portionFits = (main, portion, tpl, atMins) => {
    if (portion.svc.rid === main.svc.rid) return false;
    if (isOvernightPassenger(portion.calls)) return false;
    const oOrig = portion.calls[0];
    if (String(oOrig.tiploc || "").toUpperCase() !== tpl) return false;
    const mainOrig = String(main.calls[0].tiploc || "").toUpperCase();
    const mainDest = String(main.calls[main.calls.length - 1].tiploc || "").toUpperCase();
    const oDest = String(portion.calls[portion.calls.length - 1].tiploc || "").toUpperCase();
    if (!oDest || oDest === mainDest || oDest === tpl) return false;
    if (portion.calls.some((c) => String(c.tiploc || "").toUpperCase() === mainOrig)) return false;
    if (minutesApart(atMins, callClockFromRow(oOrig)) > 90) return false;
    if (atMins == null || callClockFromRow(oOrig) == null) return false;
    const splitDay = eventYmd(main.ssd, atMins, true);
    const portionDay = eventYmd(portion.ssd, callClockFromRow(oOrig), false);
    if (splitDay && portionDay && splitDay === portionDay) return true;
    return !ssdFromRid(main.svc.rid) && !ssdFromRid(portion.svc.rid) && main.db === portion.db;
  };

  const feederFits = (main, feeder, tpl, atMins) => {
    if (feeder.svc.rid === main.svc.rid) return false;
    const last = feeder.calls[feeder.calls.length - 1];
    if (String(last.tiploc || "").toUpperCase() !== tpl) return false;
    const orig = String(feeder.calls[0].tiploc || "").toUpperCase();
    const mainOrig = String(main.calls[0].tiploc || "").toUpperCase();
    const mainDest = String(main.calls[main.calls.length - 1].tiploc || "").toUpperCase();
    if (!orig || orig === tpl || orig === mainOrig) return false;
    if (tpl === mainDest) return false;
    const lastMins = callClockFromRow(last);
    if (atMins == null || lastMins == null) return false;
    if (minutesApart(atMins, lastMins) > 90) return false;
    if (lastMins >= 3 * 60 && lastMins < 18 * 60) return false;
    const joinDay = eventYmd(main.ssd, atMins, true);
    const feederDay = eventYmd(feeder.ssd, lastMins, isOvernightPassenger(feeder.calls));
    if (joinDay && feederDay && joinDay === feederDay) return true;
    return !ssdFromRid(main.svc.rid) && !ssdFromRid(feeder.svc.rid) && main.db === feeder.db;
  };

  if (mineOvernight && mine.calls.length >= 3) {
    for (let i = 1; i < mine.calls.length - 1; i++) {
      const call = mine.calls[i];
      const tpl = String(call.tiploc || "").toUpperCase();
      if (!tpl || tpl === origTpl || tpl === destTpl) continue;
      const atMins = callClockFromRow(call);
      const joinHour = atMins != null && (atMins < 3 * 60 || atMins >= 23 * 60);
      for (const other of workings) {
        if (joinHour) {
          if (!feederFits(mine, other, tpl, atMins)) continue;
          pushDivide(out, seen, mine, other, tpl, stationName, "main", "JJ");
        } else {
          if (!portionFits(mine, other, tpl, atMins)) continue;
          pushDivide(out, seen, mine, other, tpl, stationName, "main", "VV");
        }
      }
    }
  }
  if (mineOvernight && destTpl === "EDINBUR") {
    const tpl = destTpl;
    const atMins = callClockFromRow(mine.calls[mine.calls.length - 1]);
    for (const other of workings) {
      if (other.svc.rid === mine.svc.rid) continue;
      if (!isOvernightPassenger(other.calls)) continue;
      const otherDest = String(other.calls[other.calls.length - 1].tiploc || "").toUpperCase();
      if (otherDest !== "EUSTON") continue;
      for (const call of other.calls.slice(1, -1)) {
        if (String(call.tiploc || "").toUpperCase() !== tpl) continue;
        if (!feederFits(other, mine, tpl, callClockFromRow(call))) continue;
        pushDivide(out, seen, other, mine, tpl, stationName, "associated", "JJ");
        for (const sibling of workings) {
          if (sibling.svc.rid === mine.svc.rid) continue;
          if (!feederFits(other, sibling, tpl, callClockFromRow(call))) continue;
          pushDivide(out, seen, other, sibling, tpl, stationName, "main", "JJ");
        }
      }
    }
  } else if (!mineOvernight) {
    const tpl = origTpl;
    const atMins = callClockFromRow(mine.calls[0]);
    const myDay = eventYmd(mine.ssd, atMins, false);
    for (const other of workings) {
      if (other.svc.rid === mine.svc.rid) continue;
      if (isOvernightPassenger(other.calls)) {
        for (const call of other.calls.slice(1, -1)) {
          if (String(call.tiploc || "").toUpperCase() !== tpl) continue;
          if (!portionFits(other, mine, tpl, callClockFromRow(call))) continue;
          pushDivide(out, seen, other, mine, tpl, stationName, "associated");
          for (const sibling of workings) {
            if (sibling.svc.rid === mine.svc.rid) continue;
            if (!portionFits(other, sibling, tpl, callClockFromRow(call))) continue;
            pushDivide(out, seen, other, sibling, tpl, stationName, "main");
          }
        }
        continue;
      }
      const oOrig = other.calls[0];
      if (String(oOrig.tiploc || "").toUpperCase() !== tpl) continue;
      const oDest = String(other.calls[other.calls.length - 1].tiploc || "").toUpperCase();
      if (!oDest || oDest === destTpl || oDest === tpl) continue;
      if (minutesApart(atMins, callClockFromRow(oOrig)) > 90) continue;
      const oDay = eventYmd(other.ssd, callClockFromRow(oOrig), false);
      if (!myDay || myDay !== oDay) continue;
      pushDivide(out, seen, mine, other, tpl, stationName, "main");
    }
  }
  out.sort((a, b) => Number(a.role !== "associated") - Number(b.role !== "associated"));
  const associated = out.filter((a) => a.role === "associated" && a.category === "VV");
  if (associated.length > 1 && mine.ssd) {
    const previousEvening = addCalendarDays(mine.ssd, -1);
    const prefer = associated.filter((a) => ssdFromRid(a.otherRid) === previousEvening);
    const keepRid = (prefer[0] || associated[0]).otherRid;
    return out.filter((a) => a.role !== "associated" || a.category !== "VV" || a.otherRid === keepRid);
  }
  return out;
}

/**
 * When CIF/Darwin associations are missing, recover a divide from PTAC:
 * a unit leaves this RID before the advertised train destination and starts
 * another UID from that TIPLOC within 45 minutes.
 */
export function inferAssociationsFromConsist({ db, catalog, ymd, svc, consist, stationName }) {
  if (!db || !catalog || !consist || !svc?.uid) return [];
  const mine = unitEnds(consist);
  const out = [];
  const seen = new Set();

  const considerPartner = (unitId, tpl, minutes, category, role) => {
    if (!unitId || !tpl) return;
    const rows = catalog
      .prepare(`SELECT uid, headcode, json, unit_ids FROM consists WHERE ssd = ? AND unit_ids LIKE ?`)
      .all(ymd, `%"${unitId}"%`);
    for (const row of rows) {
      const uid = String(row.uid || "").toUpperCase();
      if (!uid || uid === String(svc.uid).toUpperCase()) continue;
      if (!unitIdsFromConsistRow(row).includes(unitId)) continue;
      const otherConsist = parseConsistJson(row);
      const otherEnds = unitEnds(otherConsist);
      const otherSvc = lookupServiceByUid(db, uid);
      if (!otherSvc?.rid) continue;
      if (role === "main") {
        const start = otherEnds.first.get(unitId);
        if (!start || start.tpl !== tpl) continue;
        if (minutesApart(minutes, start.minutes) > 45) continue;
      } else {
        const end = otherEnds.last.get(unitId);
        if (!end || end.tpl !== tpl) continue;
        if (minutesApart(minutes, end.minutes) > 45) continue;
      }
      const key = `${otherSvc.rid}|${tpl}|${category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const destCall = destOfService(db, otherSvc, stationName);
      const origCall = originOfService(db, otherSvc, stationName);
      const otherTrainId = otherSvc.headcode || row.headcode || null;
      if (!isPassengerHeadcode(otherTrainId)) continue;
      out.push({
        category,
        tiploc: tpl,
        tiplocName: stationName?.(null, tpl) || tpl,
        tiplocCrs: null,
        mainRid: role === "main" ? svc.rid : otherSvc.rid,
        assocRid: role === "main" ? otherSvc.rid : svc.rid,
        role,
        otherRid: otherSvc.rid,
        otherUid: otherSvc.uid || row.uid || null,
        otherTrainId,
        otherToc: otherSvc.toc || null,
        otherOriginName: origCall,
        otherDestinationName: destCall,
        mainTime: null,
        assocTime: null,
        isCancelled: Boolean(otherSvc.cancelled),
        isDeleted: false,
      });
    }
  };

  for (const [unitId, last] of mine.last) {
    if (last.tpl && mine.trainDest && last.tpl !== mine.trainDest) {
      considerPartner(unitId, last.tpl, last.minutes, "VV", "main");
    }
  }
  for (const [unitId, first] of mine.first) {
    if (first.tpl && mine.trainOrig && first.tpl !== mine.trainOrig) {
      considerPartner(unitId, first.tpl, first.minutes, "VV", "associated");
    }
  }
  return out;
}

function destOfService(db, svc, stationName) {
  if (!db) return svc.destination_name || null;
  const row = db
    .prepare(
      `SELECT crs, tiploc FROM calls WHERE rid = ? AND IFNULL(is_passing,0)=0
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(svc.rid);
  return stationName?.(row?.crs, row?.tiploc) || svc.destination_name || row?.tiploc || null;
}

function originOfService(db, svc, stationName) {
  if (!db) return svc.origin_name || null;
  const row = db
    .prepare(
      `SELECT crs, tiploc FROM calls WHERE rid = ? AND IFNULL(is_passing,0)=0
       ORDER BY seq ASC LIMIT 1`,
    )
    .get(svc.rid);
  return stationName?.(row?.crs, row?.tiploc) || svc.origin_name || row?.tiploc || null;
}

export function associationsForRid(db, rid, stationName) {
  ensureAssociationsTable(db);
  const rows = db
    .prepare(
      `SELECT * FROM associations WHERE (main_rid = ? OR assoc_rid = ?) AND is_deleted = 0`,
    )
    .all(rid, rid);
  const out = [];
  for (const row of rows) {
    if (!["VV", "JJ", "NP"].includes(row.category)) continue;
    if (row.category === "VV" && !row.main_uid && !row.assoc_uid) continue;
    const role = row.main_rid === rid ? "main" : "associated";
    const otherRid = role === "main" ? row.assoc_rid : row.main_rid;
    const other = db.prepare(`SELECT * FROM services WHERE rid = ?`).get(otherRid);
    const otherTrainId = other?.headcode || other?.train_id || null;
    if (!isPassengerHeadcode(otherTrainId)) continue;
    out.push({
      category: row.category,
      tiploc: row.tiploc,
      tiplocName: stationName?.(null, row.tiploc) || row.tiploc,
      tiplocCrs: null,
      mainRid: row.main_rid,
      assocRid: row.assoc_rid,
      role,
      otherRid,
      otherUid: other?.uid || (role === "main" ? row.assoc_uid : row.main_uid) || null,
      otherTrainId,
      otherToc: other?.toc || null,
      otherOriginName: other ? originOfService(db, other, stationName) : null,
      otherDestinationName: other ? destOfService(db, other, stationName) : null,
      mainTime: null,
      assocTime: null,
      isCancelled: Boolean(row.is_cancelled || other?.cancelled),
      isDeleted: false,
    });
  }
  return out;
}

export function publicDivideAssociations(associations, toc = null, journeyTpls = []) {
  const rows = (associations || []).filter(
    (a) => a.category === "VV" && a.role === "main" && !a.isCancelled && !a.isDeleted && a.otherDestinationName,
  );
  const byTpl = new Map();
  for (const a of rows) {
    const k = String(a.tiploc || "").toUpperCase();
    if (!byTpl.has(k)) byTpl.set(k, []);
    byTpl.get(k).push(a);
  }
  const cs = String(toc || "").toUpperCase() === "CS";
  const keep = [];
  const unique = [];
  for (const [tpl, group] of byTpl) {
    if (group.length === 1) unique.push([tpl, group[0]]);
    else if (cs && group.length <= 3) keep.push(...group);
  }
  if (cs) return [...keep, ...unique.map(([, a]) => a)];
  if (unique.length === 1) return [unique[0][1]];
  const order = (journeyTpls || []).map((t) => String(t || "").toUpperCase());
  if (order.length && unique.length) {
    let best = unique[0][1];
    let besti = -1;
    for (const [tpl, a] of unique) {
      const i = order.lastIndexOf(tpl);
      if (i >= besti) {
        besti = i;
        best = a;
      }
    }
    return [best];
  }
  return [];
}

export function filterDisplayAssociations(associations, toc = null, journeyTpls = []) {
  const keepMain = new Set(publicDivideAssociations(associations, toc, journeyTpls).map((a) => `${a.otherRid}|${a.tiploc}`));
  return (associations || []).filter((a) => {
    if (!isPassengerHeadcode(a.otherTrainId)) return false;
    if (a.category !== "VV" || a.role !== "main") return true;
    return keepMain.has(`${a.otherRid}|${a.tiploc}`);
  });
}

export function combinedDestinationName(ownName, associations, toc = null, journeyTpls = []) {
  const extras = publicDivideAssociations(associations, toc, journeyTpls).map((a) => a.otherDestinationName);
  const names = [...new Set([ownName, ...extras].filter(Boolean))];
  if (names.length <= 1) return ownName;
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function mergeAssociations(stored, inferred) {
  const out = [...(stored || [])];
  const key = (a) => `${a.category}|${a.otherRid}|${a.tiploc}|${a.role}`;
  const seen = new Set(out.map(key));
  for (const a of inferred || []) {
    if (seen.has(key(a))) continue;
    seen.add(key(a));
    out.push(a);
  }
  return out;
}

/** Morning CS portions can see last-night and tonight 1S25; keep the previous SSD. */
export function collapseOvernightAssociates(associations, selfSsd) {
  const list = associations || [];
  const groups = new Map();
  for (const a of list) {
    if (a.role !== "associated" || a.category !== "VV" || a.isDeleted) continue;
    const k = String(a.tiploc || "").toUpperCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const drop = new Set();
  const previousEvening = selfSsd ? addCalendarDays(selfSsd, -1) : null;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const prefer = previousEvening ? group.filter((a) => ssdFromRid(a.otherRid) === previousEvening) : [];
    const keepRid = (prefer[0] || group[0]).otherRid;
    for (const a of group) {
      if (a.otherRid !== keepRid) drop.add(`${a.otherRid}|${a.tiploc}|${a.role}`);
    }
  }
  if (!drop.size) return list;
  return list.filter((a) => !drop.has(`${a.otherRid}|${a.tiploc}|${a.role}`));
}

export function persistInferred(db, _rid, associations) {
  for (const a of associations || []) {
    if (!a.mainRid || !a.assocRid) continue;
    upsertAssociation(db, {
      main_rid: a.mainRid,
      assoc_rid: a.assocRid,
      category: a.category,
      tiploc: a.tiploc,
      is_cancelled: a.isCancelled ? 1 : 0,
      is_deleted: 0,
      updated_at: Date.now(),
    });
  }
}
