import { hhmm, liveKind, openCatalog, openDayDb, operatingDayYmd, upsertCall } from "./db.js";
import { nrodCandidateDays, writeDaysForRid } from "./nrod-write-days.js";
import { clearReinstatementLinks, linkReinstatement, refreshEnRouteFlag } from "./reinstatement.js";
import { trustCancelReason } from "./service-cancel.js";
import { headcodeFromTrustTrainId, tocFromTrustId } from "./toc-ids.js";

function movementTimes(body) {
  const actual = hhmm(body.actual_timestamp || body.actual || body.event_time);
  const planned = hhmm(body.planned_timestamp || body.planned || body.gbtt_timestamp);
  return { actual, planned };
}

function eventKind(body) {
  const et = String(body.event_type || "").toUpperCase();
  if (et === "PASS") return "PASS";
  if (et === "ARRIVAL") return "ARRIVAL";
  if (et === "DEPARTURE") return "DEPARTURE";
  const planned = String(body.planned_event_type || "").toUpperCase();
  if (planned === "PASS") return "PASS";
  return et || "DEPARTURE";
}

function corpusByStanox(dataDir, stanox) {
  if (!stanox) return null;
  const cat = openCatalog(dataDir);
  try {
    return cat.prepare(`SELECT tiploc, crs, name FROM corpus WHERE stanox = ?`).get(String(stanox)) || null;
  } finally {
    cat.close();
  }
}

function resolveRid(db, body, tiploc) {
  let rid = body.rid || null;
  const uid = body.uid || body.train_uid || null;
  if (!rid && uid) {
    const rows = db.prepare(`SELECT rid FROM services WHERE uid = ? COLLATE NOCASE`).all(String(uid));
    if (rows.length === 1) rid = rows[0].rid;
  }
  if (!rid && body.train_id) {
    const mapped = db.prepare(`SELECT uid FROM trust_trains WHERE train_id = ?`).get(String(body.train_id));
    if (mapped?.uid) {
      const rows = db.prepare(`SELECT rid FROM services WHERE uid = ? COLLATE NOCASE`).all(String(mapped.uid));
      if (rows.length === 1) rid = rows[0].rid;
    }
  }
  const headcode = headcodeFromTrustTrainId(body.train_id || body.trainId || body.revised_train_id);
  const toc = tocFromTrustId(body.toc || body.toc_id);
  if (!rid && tiploc && headcode) {
    const rows = toc
      ? db
          .prepare(
            `SELECT DISTINCT s.rid FROM services s JOIN calls c ON c.rid = s.rid
             WHERE c.tiploc = ? AND s.headcode = ? COLLATE NOCASE AND s.toc = ? COLLATE NOCASE`,
          )
          .all(tiploc, headcode, toc)
      : db
          .prepare(
            `SELECT DISTINCT s.rid FROM services s JOIN calls c ON c.rid = s.rid
             WHERE c.tiploc = ? AND s.headcode = ? COLLATE NOCASE`,
          )
          .all(tiploc, headcode);
    if (rows.length === 1) rid = rows[0].rid;
  }
  if (!rid && headcode && toc) {
    const rows = db
      .prepare(`SELECT rid FROM services WHERE headcode = ? COLLATE NOCASE AND toc = ? COLLATE NOCASE`)
      .all(headcode, toc);
    if (rows.length === 1) rid = rows[0].rid;
  }
  return rid;
}

function resolveRidAcrossDays(dataDir, operatingDay, body, tiploc) {
  for (const day of nrodCandidateDays(operatingDay)) {
    const db = openDayDb(dataDir, day);
    try {
      const rid = resolveRid(db, body, tiploc);
      if (rid) return rid;
    } finally {
      db.close();
    }
  }
  return null;
}

function recordTrustEvent(db, message, header, body) {
  db.prepare(
    `INSERT OR IGNORE INTO trust_events (event_id, train_id, uid, loc_stanox, event_type, planned, actual, json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `${header.msg_queue_timestamp || Date.now()}:${body.train_id || ""}:${body.loc_stanox || ""}:${body.event_type || header.msg_type}`,
    body.train_id || null,
    body.train_uid || null,
    body.loc_stanox || null,
    body.event_type || header.msg_type || null,
    body.planned_timestamp || null,
    body.actual_timestamp || null,
    JSON.stringify(message),
    Date.now(),
  );
}

export function applyTrustActivation(db, body) {
  const trainId = String(body.train_id || "");
  if (!trainId) return false;
  db.prepare(
    `INSERT INTO trust_trains (train_id, uid, toc_id, activated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(train_id) DO UPDATE SET uid=COALESCE(excluded.uid, trust_trains.uid), toc_id=COALESCE(excluded.toc_id, trust_trains.toc_id)`,
  ).run(trainId, body.train_uid || body.uid || null, body.toc_id || null, Date.now());
  return true;
}

function overlayMovement(db, body, rid, loc) {
  const uid =
    body.uid ||
    body.train_uid ||
    db.prepare(`SELECT uid FROM trust_trains WHERE train_id = ?`).get(String(body.train_id || ""))?.uid;
  const toc = tocFromTrustId(body.toc || body.toc_id);
  const headcode = headcodeFromTrustTrainId(body.train_id || body.trainId);
  const tiploc = loc?.tiploc;
  const crs = loc?.crs || null;
  if (toc || headcode) {
    db.prepare(
      `UPDATE services SET
        toc = COALESCE(NULLIF(toc, ''), ?),
        operator_name = COALESCE(NULLIF(operator_name, ''), ?),
        headcode = COALESCE(NULLIF(headcode, ''), ?),
        uid = COALESCE(NULLIF(uid, ''), ?)
       WHERE rid = ?`,
    ).run(toc, toc, headcode, uid || null, rid);
  }
  const kind = eventKind(body);
  const { actual, planned } = movementTimes(body);
  const existing = tiploc
    ? db.prepare(`SELECT is_passing FROM calls WHERE rid = ? AND tiploc = ?`).get(String(rid), tiploc)
    : null;
  const publicStop = existing && !Number(existing.is_passing);
  const existingPass = existing && Number(existing.is_passing);
  const isPass = Boolean(existingPass) || (!publicStop && (kind === "PASS" || body.is_pass));
  if (tiploc && (existing || isPass)) {
    upsertCall(
      db,
      {
        rid: String(rid),
        tiploc,
        crs,
        seq: 0,
        is_passing: publicStop ? 0 : isPass ? 1 : 0,
        cancelled: 0,
        platform: body.platform ? String(body.platform).trim() : null,
        length_cars: null,
        formation: null,
        sta: null,
        std: planned,
        wta: null,
        wtd: planned && !isPass ? planned : null,
        wtp: isPass ? planned : null,
        ata: kind === "ARRIVAL" && !isPass ? actual : null,
        atd: kind === "DEPARTURE" && !isPass ? actual : null,
        atp: isPass ? actual : null,
        eta: null,
        etd: null,
        etp: null,
        delay_minutes: body.timetable_variation != null ? Number(body.timetable_variation) : null,
        status: kind,
        live_kind: liveKind({
          ata: kind === "ARRIVAL" && !isPass ? actual : null,
          atd: kind === "DEPARTURE" && !isPass ? actual : null,
          atp: isPass ? actual : null,
        }),
        actual_source: "trust",
        updated_at: Date.now(),
      },
      { overlay: Boolean(existing), fillOnly: true },
    );
  }
}

export function applyTrustMovement(dataDir, body, ymd = operatingDayYmd(), opts = {}) {
  const overlayCalls = opts.overlayCalls ?? true;
  if (!overlayCalls) return true;
  const loc = corpusByStanox(dataDir, body.loc_stanox || body.locStanox);
  const db = openDayDb(dataDir, ymd);
  try {
    const uid =
      body.uid ||
      body.train_uid ||
      db.prepare(`SELECT uid FROM trust_trains WHERE train_id = ?`).get(String(body.train_id || ""))?.uid;
    const rid = resolveRid(db, { ...body, uid }, loc?.tiploc);
    if (!rid) return false;
    overlayMovement(db, { ...body, uid }, rid, loc);
    return true;
  } finally {
    db.close();
  }
}

function callWasReached(call) {
  return [call?.ata, call?.atd, call?.atp].some((value) => String(value || "").trim());
}

/**
 * EN ROUTE cancels the journey from the cancel location forward.
 * A call already reached stays, including an arrival at the cancel location
 * with no departure. Every later call that has not been recorded is cancelled.
 * Returns whether a public call exists before that location.
 */
function markCallsCancelledFrom(db, rid, tiploc) {
  const calls = db
    .prepare(`SELECT seq, tiploc, is_passing, ata, atd, atp FROM calls WHERE rid = ? ORDER BY seq`)
    .all(rid);
  const idx = calls.findIndex((call) => String(call.tiploc).toUpperCase() === String(tiploc).toUpperCase());
  if (idx < 0) return { found: false, publicBefore: false };
  const publicBefore = calls.slice(0, idx).some((call) => !Number(call.is_passing));
  const from = callWasReached(calls[idx]) ? idx + 1 : idx;
  for (const call of calls.slice(from)) {
    if (callWasReached(call)) continue;
    db.prepare(`UPDATE calls SET cancelled = 1 WHERE rid = ? AND seq = ?`).run(rid, call.seq);
  }
  return { found: true, publicBefore };
}

function applyCancel(db, rid, body, loc) {
  const svc = db.prepare(`SELECT cancelled, cancel_reason FROM services WHERE rid = ?`).get(rid);
  if (!svc) return false;
  if (Number(svc.cancelled) && !String(svc.cancel_reason || "").startsWith("TRUST:")) return true;
  const code = body.canx_reason_code || body.cancel_reason_code || body.reason_code || "";
  const enRoute = String(body.canx_type || "").toUpperCase().replace(/\s+/g, " ").includes("EN ROUTE");
  const tiploc = enRoute ? loc?.tiploc : "";
  if (tiploc) {
    const marked = markCallsCancelledFrom(db, rid, tiploc);
    if (marked.found && marked.publicBefore) {
      db.prepare(`UPDATE services SET cancelled = 0, cancel_reason = ? WHERE rid = ?`).run(
        trustCancelReason(code, tiploc),
        rid,
      );
      refreshEnRouteFlag(db);
      linkReinstatement(db, rid);
      return true;
    }
  }
  db.prepare(`UPDATE services SET cancelled = 1, cancel_reason = ? WHERE rid = ?`).run(trustCancelReason(code), rid);
  return true;
}

function applyReinstate(db, rid) {
  const svc = db.prepare(`SELECT cancelled, cancel_reason FROM services WHERE rid = ?`).get(rid);
  if (!svc) return true;
  const reason = String(svc.cancel_reason || "");
  if (!reason.startsWith("TRUST:")) return true;
  if (!Number(svc.cancelled) && !reason.includes("@")) return true;
  clearReinstatementLinks(db, rid);
  db.prepare(`UPDATE services SET cancelled = 0, cancel_reason = NULL WHERE rid = ?`).run(rid);
  db.prepare(`UPDATE calls SET cancelled = 0 WHERE rid = ?`).run(rid);
  refreshEnRouteFlag(db);
  return true;
}

function applyChangeOfOrigin(db, rid, loc) {
  if (!rid || !loc?.tiploc) return false;
  db.prepare(
    `UPDATE services SET
      origin_crs = COALESCE(?, origin_crs),
      origin_name = COALESCE(?, origin_name)
     WHERE rid = ?`,
  ).run(loc.crs || null, loc.name || null, rid);
  const dest = db.prepare(`SELECT destination_crs, destination_name FROM services WHERE rid = ?`).get(rid);
  const existing = db.prepare(`SELECT is_passing FROM calls WHERE rid = ? AND tiploc = ?`).get(rid, loc.tiploc);
  if (!existing) {
    upsertCall(db, {
      rid,
      tiploc: loc.tiploc,
      crs: loc.crs || null,
      seq: 0,
      is_passing: 0,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: null,
      ata: null,
      atd: null,
      atp: null,
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: null,
      status: "COO",
      live_kind: liveKind({}),
      actual_source: "trust",
      updated_at: Date.now(),
    });
  }
  if (dest) {
    db.prepare(`UPDATE services SET destination_crs = ?, destination_name = ? WHERE rid = ?`).run(
      dest.destination_crs,
      dest.destination_name,
      rid,
    );
  }
  return true;
}

function applyChangeOfIdentity(db, body) {
  const oldId = String(body.train_id || body.current_train_id || "");
  const newId = String(body.revised_train_id || body.new_train_id || "");
  if (!oldId || !newId) return false;
  const prev = db.prepare(`SELECT uid, toc_id, activated_at FROM trust_trains WHERE train_id = ?`).get(oldId);
  const uid = body.train_uid || body.uid || prev?.uid || null;
  const tocId = body.toc_id || prev?.toc_id || null;
  db.prepare(
    `INSERT INTO trust_trains (train_id, uid, toc_id, activated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(train_id) DO UPDATE SET uid=COALESCE(excluded.uid, trust_trains.uid), toc_id=COALESCE(excluded.toc_id, trust_trains.toc_id)`,
  ).run(newId, uid, tocId, prev?.activated_at || Date.now());
  if (oldId !== newId) db.prepare(`DELETE FROM trust_trains WHERE train_id = ?`).run(oldId);
  return true;
}

function forWriteDays(dataDir, operatingDay, rid, fn) {
  const days = writeDaysForRid(dataDir, operatingDay, rid);
  for (const day of days) {
    const db = openDayDb(dataDir, day);
    try {
      fn(db, day);
    } finally {
      db.close();
    }
  }
  return days;
}

export function healTrustCancellations(db, dataDir) {
  const events = db
    .prepare(
      `SELECT train_id, event_type, json, received_at FROM trust_events
       WHERE event_type IN ('0002', '0005') ORDER BY received_at`,
    )
    .all();
  const latest = new Map();
  for (const event of events) {
    if (!event.train_id) continue;
    const prev = latest.get(event.train_id);
    if (!prev || Number(event.received_at) >= Number(prev.received_at)) latest.set(event.train_id, event);
  }
  for (const event of latest.values()) {
    let message = null;
    try {
      message = event.json ? JSON.parse(event.json) : null;
    } catch {
      continue;
    }
    const body = { ...(message?.body || {}), train_id: event.train_id };
    const mapped = db.prepare(`SELECT uid FROM trust_trains WHERE train_id = ?`).get(event.train_id);
    const uid = body.train_uid || body.uid || mapped?.uid || null;
    const loc = corpusByStanox(dataDir, body.loc_stanox);
    const rid = resolveRid(db, { ...body, uid }, loc?.tiploc);
    if (!rid) continue;
    if (event.event_type === "0005") {
      applyReinstate(db, rid);
      continue;
    }
    const svc = db.prepare(`SELECT cancelled, cancel_reason FROM services WHERE rid = ?`).get(rid);
    if (!svc) continue;
    const code = body.canx_reason_code || body.cancel_reason_code || body.reason_code || "";
    const enRoute = String(body.canx_type || "").toUpperCase().includes("EN ROUTE") && loc?.tiploc;
    const expected = trustCancelReason(code, enRoute ? loc.tiploc : "");
    if (String(svc.cancel_reason || "") === expected) continue;
    if (!enRoute && String(svc.cancel_reason || "").startsWith("TRUST:0002") && Number(svc.cancelled)) continue;
    applyCancel(db, rid, body, loc);
  }
}

const healedAt = new Map();

function maybeHealTrustCancellations(dataDir, ymd) {
  const key = `${dataDir}|${ymd}`;
  const now = Date.now();
  if (now - (healedAt.get(key) || 0) < 60_000) return;
  healedAt.set(key, now);
  const db = openDayDb(dataDir, ymd);
  try {
    healTrustCancellations(db, dataDir);
  } finally {
    db.close();
  }
}

export function applyTrustFrame(dataDir, message, ymd = operatingDayYmd(), opts = {}) {
  const header = message?.header || {};
  const body = { ...(message?.body || message || {}), msg_type: header.msg_type };
  const type = String(header.msg_type || "");
  const loc = corpusByStanox(dataDir, body.loc_stanox || body.locStanox);
  const rid = resolveRidAcrossDays(dataDir, ymd, body, loc?.tiploc);

  if (type === "0004") {
    const db = openDayDb(dataDir, ymd);
    try {
      recordTrustEvent(db, message, header, body);
    } finally {
      db.close();
    }
    return true;
  }

  const overlayCalls = opts.overlayCalls ?? true;
  forWriteDays(dataDir, ymd, rid, (db) => {
    recordTrustEvent(db, message, header, body);
    if (type === "0001") {
      applyTrustActivation(db, body);
      return;
    }
    if (type === "0002") {
      if (rid) applyCancel(db, rid, body, loc);
      return;
    }
    if (type === "0005") {
      if (rid) applyReinstate(db, rid);
      return;
    }
    if (type === "0006") {
      if (rid) applyChangeOfOrigin(db, rid, loc);
      return;
    }
    if (type === "0007") {
      applyChangeOfIdentity(db, body);
      return;
    }
    if ((type === "0003" || body.event_type) && overlayCalls && rid) {
      overlayMovement(db, body, rid, loc);
    }
  });
  if (type === "0002" || type === "0005") maybeHealTrustCancellations(dataDir, ymd);
  if (type === "0001" || type === "0002" || type === "0003" || type === "0005" || type === "0006" || type === "0007") {
    return true;
  }
  if (body.event_type) return Boolean(rid);
  return false;
}
