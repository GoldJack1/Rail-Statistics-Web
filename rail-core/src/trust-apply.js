import { hhmm, liveKind, openCatalog, openDayDb, operatingDayYmd, upsertCall } from "./db.js";
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
  const headcode = headcodeFromTrustTrainId(body.train_id || body.trainId);
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

export function applyTrustActivation(db, body) {
  const trainId = String(body.train_id || "");
  if (!trainId) return false;
  db.prepare(
    `INSERT INTO trust_trains (train_id, uid, toc_id, activated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(train_id) DO UPDATE SET uid=COALESCE(excluded.uid, trust_trains.uid), toc_id=COALESCE(excluded.toc_id, trust_trains.toc_id)`,
  ).run(trainId, body.train_uid || body.uid || null, body.toc_id || null, Date.now());
  return true;
}

export function applyTrustMovement(dataDir, body, ymd = operatingDayYmd(), opts = {}) {
  const overlayCalls = opts.overlayCalls ?? true;
  if (!overlayCalls) return true;
  const cat = openCatalog(dataDir);
  const stanox = String(body.loc_stanox || body.locStanox || "");
  const row = stanox
    ? cat.prepare(`SELECT tiploc, crs FROM corpus WHERE stanox = ?`).get(stanox)
    : null;
  const db = openDayDb(dataDir, body.operating_day || ymd);
  const uid =
    body.uid ||
    body.train_uid ||
    db.prepare(`SELECT uid FROM trust_trains WHERE train_id = ?`).get(String(body.train_id || ""))?.uid;
  const toc = tocFromTrustId(body.toc || body.toc_id);
  const headcode = headcodeFromTrustTrainId(body.train_id || body.trainId);
  const tiploc = row?.tiploc;
  const crs = row?.crs || null;
  const rid = resolveRid(db, { ...body, uid }, tiploc);
  if (!rid) {
    cat.close();
    db.close();
    return false;
  }
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
  cat.close();
  db.close();
  return true;
}

export function applyTrustFrame(dataDir, message, ymd = operatingDayYmd(), opts = {}) {
  const header = message?.header || {};
  const body = { ...(message?.body || message || {}), msg_type: header.msg_type };
  const db = openDayDb(dataDir, ymd);
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
  db.close();
  const type = String(header.msg_type || "");
  if (type === "0001") {
    const day = openDayDb(dataDir, ymd);
    applyTrustActivation(day, body);
    day.close();
    return true;
  }
  if (type === "0003" || body.event_type) return applyTrustMovement(dataDir, body, ymd, opts);
  return false;
}
