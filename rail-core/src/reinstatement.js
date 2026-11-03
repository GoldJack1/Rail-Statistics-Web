/**
 * A short-notice cancel is often followed by a new schedule: new UID, new
 * headcode, sometimes new units, with the same public times from an
 * intermediate station. Link that schedule as the next working.
 */
import { upsertAssociation, ensureAssociationsTable } from "./associations.js";
import { openDayDb } from "./db.js";
import { parseTrustCancel } from "./service-cancel.js";

const FLAG = "trust_enroute";

function hhmm(value) {
  const match = /^(\d{2}:\d{2})/.exec(String(value || ""));
  return match ? match[1] : "";
}

function publicTime(call) {
  return hhmm(call?.std) || hhmm(call?.sta) || hhmm(call?.wtd) || hhmm(call?.wta);
}

function loadCalls(db, rid) {
  return db
    .prepare(
      `SELECT tiploc, crs, seq, is_passing, sta, std, wta, wtd FROM calls WHERE rid = ? ORDER BY seq`,
    )
    .all(rid);
}

/** The advertised destination, not a later call that belongs to the next working. */
function advertisedDest(calls, destinationCrs) {
  const pub = publicCalls(calls);
  const crs = String(destinationCrs || "").toUpperCase();
  if (crs) {
    const hit = [...pub].reverse().find((call) => String(call.crs || "").toUpperCase() === crs);
    if (hit) return hit;
  }
  return pub[pub.length - 1] || null;
}

function publicCalls(calls) {
  return (calls || []).filter((call) => !Number(call.is_passing));
}

export function hasEnRouteCancel(db) {
  try {
    return db.prepare(`SELECT value FROM meta WHERE key = ?`).get(FLAG)?.value === "1";
  } catch {
    return false;
  }
}

export function refreshEnRouteFlag(db) {
  const n = db.prepare(`SELECT COUNT(*) AS n FROM services WHERE cancel_reason LIKE 'TRUST:0002:%@%'`).get().n;
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(FLAG, n ? "1" : "0");
}

/**
 * The new train repeats the cancelled train's public times from its own origin.
 * An en-route cancel only matches a train that starts after the cancel location.
 */
export function isReinstatement(original, originalCalls, next, nextCalls) {
  const trust = parseTrustCancel(original?.cancel_reason);
  if (!trust) return null;
  if (!next?.rid || next.rid === original.rid) return null;
  if (original.uid && next.uid && String(original.uid).toUpperCase() === String(next.uid).toUpperCase()) return null;
  if (original.toc && next.toc && String(original.toc).toUpperCase() !== String(next.toc).toUpperCase()) return null;
  if (original.service_type === "freight" || next.service_type === "freight") return null;
  const nextPublic = publicCalls(nextCalls);
  if (nextPublic.length < 2) return null;
  const origin = nextPublic[0];
  const cancelIdx = trust.tiploc
    ? originalCalls.findIndex((call) => String(call.tiploc).toUpperCase() === trust.tiploc)
    : -1;
  if (trust.tiploc && cancelIdx < 0) return null;
  const after = trust.tiploc ? originalCalls[cancelIdx].seq : -1;
  const originOnOld = originalCalls.find(
    (call) => String(call.tiploc).toUpperCase() === String(origin.tiploc).toUpperCase() && call.seq > after,
  );
  if (!originOnOld) return null;
  const originTime = publicTime(origin);
  if (!originTime || originTime !== publicTime(originOnOld)) return null;
  const dest = advertisedDest(nextCalls, next.destination_crs);
  const oldDest = advertisedDest(originalCalls, original.destination_crs);
  if (!oldDest || String(oldDest.tiploc).toUpperCase() !== String(dest.tiploc).toUpperCase()) return null;
  const destTime = publicTime(dest);
  const oldDestTime = publicTime(oldDest);
  if (destTime && oldDestTime && destTime !== oldDestTime) return null;
  let shared = 0;
  for (const call of nextPublic) {
    const hit = originalCalls.find(
      (old) => String(old.tiploc).toUpperCase() === String(call.tiploc).toUpperCase() && old.seq > after,
    );
    if (!hit) continue;
    const time = publicTime(call);
    if (time && time === publicTime(hit)) shared += 1;
  }
  if (shared < 2) return null;
  return String(origin.tiploc).toUpperCase();
}

function rememberLink(db, original, next, tiploc) {
  upsertAssociation(db, {
    main_rid: original.rid,
    assoc_rid: next.rid,
    category: "NP",
    tiploc,
    main_uid: original.uid || null,
    assoc_uid: next.uid || null,
    is_cancelled: 0,
    is_deleted: 0,
  });
}

function serviceRow(db, rid) {
  return db
    .prepare(
      `SELECT rid, uid, toc, headcode, train_id, destination_crs, cancel_reason, service_type FROM services WHERE rid = ?`,
    )
    .get(rid);
}

export function linkReinstatement(db, rid) {
  const svc = serviceRow(db, rid);
  if (!svc) return false;
  let linked = false;
  const calls = loadCalls(db, rid);
  if (parseTrustCancel(svc.cancel_reason)?.tiploc) {
    const candidates = svc.destination_crs
      ? db
          .prepare(
            `SELECT rid, uid, toc, headcode, train_id, destination_crs, cancel_reason, service_type
             FROM services
             WHERE rid != ?
               AND (destination_crs = ? COLLATE NOCASE OR destination_crs IS NULL OR destination_crs = '')`,
          )
          .all(rid, svc.destination_crs)
      : db
          .prepare(
            `SELECT rid, uid, toc, headcode, train_id, destination_crs, cancel_reason, service_type
             FROM services WHERE rid != ?`,
          )
          .all(rid);
    for (const next of candidates) {
      const tiploc = isReinstatement(svc, calls, next, loadCalls(db, next.rid));
      if (!tiploc) continue;
      rememberLink(db, svc, next, tiploc);
      linked = true;
    }
  }
  const cancelled = db
    .prepare(
      `SELECT rid, uid, toc, headcode, train_id, destination_crs, cancel_reason, service_type
       FROM services WHERE cancel_reason LIKE 'TRUST:0002:%@%' AND rid != ?`,
    )
    .all(rid);
  for (const original of cancelled) {
    const tiploc = isReinstatement(original, loadCalls(db, original.rid), svc, calls);
    if (!tiploc) continue;
    rememberLink(db, original, svc, tiploc);
    linked = true;
  }
  return linked;
}

export function clearReinstatementLinks(db, rid) {
  ensureAssociationsTable(db);
  const original = serviceRow(db, rid);
  if (!original || !parseTrustCancel(original.cancel_reason)?.tiploc) return;
  const originalCalls = loadCalls(db, rid);
  const rows = db
    .prepare(`SELECT assoc_rid FROM associations WHERE main_rid = ? AND category = 'NP' AND is_deleted = 0`)
    .all(rid);
  for (const row of rows) {
    const next = serviceRow(db, row.assoc_rid);
    if (!next) continue;
    if (!isReinstatement(original, originalCalls, next, loadCalls(db, next.rid))) continue;
    db.prepare(`DELETE FROM associations WHERE main_rid = ? AND assoc_rid = ? AND category = 'NP'`).run(rid, next.rid);
  }
}

export function linkReinstatementForUid(dataDir, ymd, uid) {
  const db = openDayDb(dataDir, ymd);
  try {
    if (!hasEnRouteCancel(db)) return false;
    const rows = db.prepare(`SELECT rid FROM services WHERE uid = ? COLLATE NOCASE`).all(String(uid || ""));
    let linked = false;
    for (const row of rows) {
      if (linkReinstatement(db, row.rid)) linked = true;
    }
    return linked;
  } finally {
    db.close();
  }
}
