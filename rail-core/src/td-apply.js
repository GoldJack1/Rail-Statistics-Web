/**
 * Network Rail Train Describer (TD) berth messages → last known berth on today’s services.
 * When SMART+CORPUS map a berth to a TIPLOC and RID is known, upsert a working pass
 * (same live restore pattern as TRUST).
 */
import { hhmm, liveKind, openCatalog, openDayDb, operatingDayYmd, upsertCall } from "./db.js";
import { resolveSmartTiploc } from "./import-smart.js";

export function ensureTdTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS td_trains (
      headcode TEXT PRIMARY KEY,
      area_id TEXT,
      berth TEXT,
      from_berth TEXT,
      msg_type TEXT,
      train_id TEXT,
      rid TEXT,
      tiploc TEXT,
      stanox TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS td_events (
      event_id TEXT PRIMARY KEY,
      headcode TEXT,
      area_id TEXT,
      berth TEXT,
      from_berth TEXT,
      msg_type TEXT,
      tiploc TEXT,
      stanox TEXT,
      json TEXT,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_td_events_headcode ON td_events (headcode, received_at);
  `);
  const trainCols = new Set(db.prepare(`PRAGMA table_info(td_trains)`).all().map((c) => c.name));
  if (!trainCols.has("tiploc")) db.exec(`ALTER TABLE td_trains ADD COLUMN tiploc TEXT`);
  if (!trainCols.has("stanox")) db.exec(`ALTER TABLE td_trains ADD COLUMN stanox TEXT`);
  const eventCols = new Set(db.prepare(`PRAGMA table_info(td_events)`).all().map((c) => c.name));
  if (!eventCols.has("tiploc")) db.exec(`ALTER TABLE td_events ADD COLUMN tiploc TEXT`);
  if (!eventCols.has("stanox")) db.exec(`ALTER TABLE td_events ADD COLUMN stanox TEXT`);
}

export function tdMessages(raw) {
  if (raw == null) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    parsed = JSON.parse(s);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return [parsed];
  return [];
}

function unpackTd(msg) {
  if (!msg || typeof msg !== "object") return null;
  for (const [key, body] of Object.entries(msg)) {
    if (!/_MSG$/i.test(key) || !body || typeof body !== "object") continue;
    const msgType = String(body.msg_type || key.replace(/_MSG$/i, "")).toUpperCase();
    if (msgType === "CT" || msgType === "SF" || msgType === "SG") return null;
    const headcode = String(body.descr || body.description || "")
      .trim()
      .toUpperCase();
    if (!/^[0-9][A-Z][0-9]{2}$/.test(headcode)) return null;
    return {
      msgType,
      headcode,
      areaId: body.area_id || body.areaId || null,
      berth: body.to || body.berth || null,
      fromBerth: body.from || null,
      time: body.time || body.report_time || null,
      rawKey: key,
    };
  }
  return null;
}

function resolveRid(db, headcode) {
  const rows = db
    .prepare(
      `SELECT rid FROM services
       WHERE headcode = ? COLLATE NOCASE
       ORDER BY CASE WHEN length(rid)=15 AND rid GLOB '[0-9]*' THEN 0 ELSE 1 END
       LIMIT 2`,
    )
    .all(headcode);
  if (rows.length === 1) return rows[0].rid;
  return null;
}

function upsertTdPass(db, { rid, tiploc, crs, platform, actual }) {
  if (!rid || !tiploc) return;
  const existing = db.prepare(`SELECT is_passing FROM calls WHERE rid = ? AND tiploc = ?`).get(rid, tiploc);
  const publicStop = existing && !Number(existing.is_passing);
  if (publicStop) {
    // Don't convert a public stop into a pass; only fill live if empty.
    upsertCall(
      db,
      {
        rid: String(rid),
        tiploc,
        crs,
        seq: 0,
        is_passing: 0,
        cancelled: 0,
        platform,
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
        status: "TD",
        live_kind: liveKind({}),
        actual_source: "td",
        updated_at: Date.now(),
      },
      { overlay: true, fillOnly: true },
    );
    return;
  }
  const atp = actual || null;
  upsertCall(
    db,
    {
      rid: String(rid),
      tiploc,
      crs,
      seq: 0,
      is_passing: 1,
      cancelled: 0,
      platform,
      length_cars: null,
      formation: null,
      sta: null,
      std: null,
      wta: null,
      wtd: null,
      wtp: atp,
      ata: null,
      atd: null,
      atp,
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: null,
      status: "TD",
      live_kind: liveKind({ atp }),
      actual_source: "td",
      updated_at: Date.now(),
    },
    { overlay: Boolean(existing), fillOnly: true },
  );
}

export function applyTdFrame(dataDir, message, ymd = operatingDayYmd()) {
  const parsed = unpackTd(message);
  if (!parsed) return false;
  const db = openDayDb(dataDir, ymd);
  ensureTdTables(db);
  const now = Date.now();
  const rid = resolveRid(db, parsed.headcode);
  const berth = parsed.berth || parsed.fromBerth;
  if (!berth && !parsed.fromBerth) {
    db.close();
    return false;
  }

  let tiploc = null;
  let stanox = null;
  let crs = null;
  let platform = null;
  try {
    const cat = openCatalog(dataDir);
    const mapped = resolveSmartTiploc(cat, parsed.areaId, berth, parsed.fromBerth);
    cat.close();
    if (mapped) {
      tiploc = mapped.tiploc;
      stanox = mapped.stanox;
      crs = mapped.crs;
      platform = mapped.platform;
    }
  } catch {
    /* SMART optional */
  }

  db.prepare(
    `INSERT OR REPLACE INTO td_trains (headcode, area_id, berth, from_berth, msg_type, train_id, rid, tiploc, stanox, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    parsed.headcode,
    parsed.areaId,
    berth,
    parsed.fromBerth,
    parsed.msgType,
    null,
    rid,
    tiploc,
    stanox,
    now,
  );
  db.prepare(
    `INSERT OR IGNORE INTO td_events (event_id, headcode, area_id, berth, from_berth, msg_type, tiploc, stanox, json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `${now}:${parsed.areaId || ""}:${parsed.headcode}:${parsed.msgType}:${berth || ""}:${parsed.fromBerth || ""}`,
    parsed.headcode,
    parsed.areaId,
    berth,
    parsed.fromBerth,
    parsed.msgType,
    tiploc,
    stanox,
    JSON.stringify(message),
    now,
  );

  // CA = berth step, CC = interpose. CB/CT handled elsewhere / ignored for path.
  if (rid && tiploc && (parsed.msgType === "CA" || parsed.msgType === "CC")) {
    const actual = parsed.time ? hhmm(parsed.time) : hhmm(now);
    upsertTdPass(db, { rid, tiploc, crs, platform, actual });
  }

  db.close();
  return true;
}

export function tdForHeadcode(db, headcode) {
  if (!headcode) return null;
  ensureTdTables(db);
  const row =
    db
      .prepare(
        `SELECT headcode, area_id AS areaId, berth, from_berth AS fromBerth, msg_type AS msgType,
                rid, tiploc, stanox, updated_at AS updatedAt
         FROM td_trains WHERE headcode = ? COLLATE NOCASE`,
      )
      .get(String(headcode).toUpperCase()) || null;
  if (!row) return null;
  return row;
}
