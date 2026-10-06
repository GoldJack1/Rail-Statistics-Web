/**
 * Network Rail Train Describer (TD) berth messages → last known berth on today’s services.
 * When SMART+CORPUS map a berth to a TIPLOC and RID is known, upsert a working pass
 * (same live restore pattern as TRUST).
 */
import { hhmm, hhmmLondon, liveKind, openCatalog, openDayDb, operatingDayYmd, upsertCall } from "./db.js";
import { resolveSmartTiploc } from "./import-smart.js";
import { nrodCandidateDays, writeDaysForRid } from "./nrod-write-days.js";

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

function resolveRidCandidates(db, headcode) {
  return db
    .prepare(
      `SELECT rid FROM services
       WHERE headcode = ? COLLATE NOCASE
       ORDER BY CASE WHEN length(rid)=15 AND rid GLOB '[0-9]*' THEN 0 ELSE 1 END`,
    )
    .all(headcode)
    .map((r) => r.rid);
}

function resolveRid(db, headcode) {
  const rows = resolveRidCandidates(db, headcode);
  if (rows.length === 1) return rows[0];
  return null;
}

function ridsForTdPass(db, headcode, tiploc, forcedRid = null) {
  if (forcedRid) return [forcedRid];
  const candidates = resolveRidCandidates(db, headcode);
  if (candidates.length === 1) return candidates;
  if (!tiploc || !candidates.length) return [];
  const tpl = String(tiploc).toUpperCase();
  return candidates.filter((rid) => spineTiplocs(db, rid)?.has(tpl));
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

function resolveRidAcrossDays(dataDir, operatingDay, headcode) {
  for (const day of nrodCandidateDays(operatingDay)) {
    const db = openDayDb(dataDir, day);
    try {
      const rid = resolveRid(db, headcode);
      if (rid) return rid;
    } finally {
      db.close();
    }
  }
  return null;
}

/** Service spine TIPLOCs for SMART disambiguation when berths map to multiple STANOX. */
function spineTiplocs(db, rid) {
  if (!rid) return null;
  const rows = db.prepare(`SELECT tiploc FROM calls WHERE rid = ? ORDER BY seq`).all(rid);
  if (!rows.length) return null;
  return new Set(rows.map((r) => String(r.tiploc).toUpperCase()));
}

function spineHintsForHeadcode(db, headcode, dayRid = null) {
  if (dayRid) return spineTiplocs(db, dayRid);
  const candidates = resolveRidCandidates(db, headcode);
  if (candidates.length <= 1) return spineTiplocs(db, candidates[0]);
  const union = new Set();
  for (const r of candidates) {
    for (const t of spineTiplocs(db, r) || []) union.add(t);
  }
  return union.size ? union : null;
}

function resolveTdMapping(catalog, parsed, berth, hintTiplocs) {
  const mapped = resolveSmartTiploc(catalog, parsed.areaId, berth, parsed.fromBerth, {
    hintTiplocs,
  });
  if (!mapped) return { tiploc: null, stanox: null, crs: null, platform: null };
  return {
    tiploc: mapped.tiploc,
    stanox: mapped.stanox,
    crs: mapped.crs,
    platform: mapped.platform,
  };
}

function applyTdToDay(db, message, parsed, { rid, tiploc, stanox, crs, platform, berth, now, replay = false, forcedRid = null }) {
  ensureTdTables(db);
  const dayRid = forcedRid || resolveRid(db, parsed.headcode);
  if (!replay) {
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
      dayRid,
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
  }

  // CA = berth step, CC = interpose. CB/CT handled elsewhere / ignored for path.
  if (tiploc && (parsed.msgType === "CA" || parsed.msgType === "CC")) {
    const actual = parsed.time ? hhmm(parsed.time) : hhmmLondon(now);
    for (const passRid of ridsForTdPass(db, parsed.headcode, tiploc, forcedRid)) {
      upsertTdPass(db, { rid: passRid, tiploc, crs, platform, actual });
    }
  }
}

export function applyTdFrame(dataDir, message, ymd = operatingDayYmd(), opts = {}) {
  const parsed = unpackTd(message);
  if (!parsed) return false;
  const berth = parsed.berth || parsed.fromBerth;
  if (!berth && !parsed.fromBerth) return false;

  const now = opts.at ?? Date.now();
  const rid = resolveRidAcrossDays(dataDir, ymd, parsed.headcode);
  const days = writeDaysForRid(dataDir, ymd, rid);

  let catalog = null;
  try {
    catalog = openCatalog(dataDir);
  } catch {
    /* SMART optional */
  }

  for (const day of days) {
    const db = openDayDb(dataDir, day);
    try {
      const dayRid = resolveRid(db, parsed.headcode) || rid;
      const hints = spineHintsForHeadcode(db, parsed.headcode, dayRid);
      const { tiploc, stanox, crs, platform } = catalog
        ? resolveTdMapping(catalog, parsed, berth, hints)
        : { tiploc: null, stanox: null, crs: null, platform: null };
      applyTdToDay(db, message, parsed, {
        rid,
        tiploc,
        stanox,
        crs,
        platform,
        berth,
        now,
        replay: Boolean(opts.replay),
      });
    } finally {
      db.close();
    }
  }

  catalog?.close();
  return true;
}

function unambiguousHeadcodeRids(db) {
  const ridByHead = new Map();
  const ambiguous = new Set();
  for (const row of db
    .prepare(`SELECT headcode, rid FROM services WHERE headcode IS NOT NULL AND headcode != ''`)
    .all()) {
    const hc = String(row.headcode).toUpperCase();
    if (ambiguous.has(hc)) continue;
    if (ridByHead.has(hc)) {
      ridByHead.delete(hc);
      ambiguous.add(hc);
    } else {
      ridByHead.set(hc, row.rid);
    }
  }
  return { ridByHead, ambiguous };
}

function mappingCacheKey(areaId, fromBerth, berth, hints) {
  const hintList = hints?.size ? [...hints].sort().join(",") : "";
  return `${areaId || ""}|${fromBerth || ""}|${berth || ""}|${hintList}`;
}

/** Re-apply stored TD events with current SMART/CORPUS (e.g. after SMART import). */
export function replayTdEventsForDay(dataDir, ymd, opts = {}) {
  const forcedRid = opts.rid ? String(opts.rid) : null;
  let headcodeFilter = opts.headcode ? String(opts.headcode).toUpperCase() : null;

  let catalog;
  try {
    catalog = openCatalog(dataDir);
  } catch {
    return { applied: 0, total: 0, skipped: "no catalog" };
  }

  const db = openDayDb(dataDir, ymd);
  db.exec("PRAGMA busy_timeout=300000");
  ensureTdTables(db);

  if (forcedRid && !headcodeFilter) {
    headcodeFilter =
      db.prepare(`SELECT headcode FROM services WHERE rid = ?`).get(forcedRid)?.headcode?.toUpperCase() || null;
  }

  const { ridByHead, ambiguous } = unambiguousHeadcodeRids(db);
  const spineCache = new Map();
  const mapCache = new Map();
  const hintSpine = (rid) => {
    if (!rid) return null;
    if (!spineCache.has(rid)) spineCache.set(rid, spineTiplocs(db, rid));
    return spineCache.get(rid);
  };

  const sql = headcodeFilter
    ? `SELECT json, received_at, headcode, area_id, berth, from_berth, msg_type
       FROM td_events
       WHERE headcode = ? COLLATE NOCASE AND msg_type IN ('CA', 'CC')
       ORDER BY received_at`
    : `SELECT json, received_at, headcode, area_id, berth, from_berth, msg_type
       FROM td_events
       WHERE msg_type IN ('CA', 'CC')
       ORDER BY received_at`;
  const stmt = db.prepare(sql);
  const rows = headcodeFilter ? stmt.iterate(headcodeFilter) : stmt.iterate();

  let total = 0;
  let applied = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      total++;
      const headcode = String(row.headcode || "").toUpperCase();
      if (!headcode) continue;

      let parsed;
      try {
        parsed = unpackTd(JSON.parse(row.json));
      } catch {
        continue;
      }
      if (!parsed) continue;

      const berth = row.berth || parsed.berth || parsed.fromBerth;
      const fromBerth = row.from_berth || parsed.fromBerth;
      const areaId = row.area_id || parsed.areaId;

      const targetRids = forcedRid
        ? [forcedRid]
        : ambiguous.has(headcode)
          ? []
          : ridByHead.has(headcode)
            ? [ridByHead.get(headcode)]
            : [];
      if (!forcedRid && ambiguous.has(headcode)) {
        // Ambiguous headcode without forced RID: try spine match per candidate.
        const hintsUnion = new Set();
        for (const rid of resolveRidCandidates(db, headcode)) {
          for (const t of hintSpine(rid) || []) hintsUnion.add(t);
        }
        const mk = mappingCacheKey(areaId, fromBerth, berth, hintsUnion);
        let mapped = mapCache.get(mk);
        if (!mapped) {
          mapped = resolveTdMapping(catalog, { areaId, fromBerth }, berth, hintsUnion);
          mapCache.set(mk, mapped);
        }
        const { tiploc, crs, platform } = mapped;
        if (!tiploc) continue;
        const actual = parsed.time ? hhmm(parsed.time) : hhmmLondon(row.received_at);
        for (const passRid of ridsForTdPass(db, headcode, tiploc)) {
          upsertTdPass(db, { rid: passRid, tiploc, crs, platform, actual });
          applied++;
        }
        continue;
      }
      if (!targetRids.length) continue;

      const hints = hintSpine(targetRids[0]);
      const mk = mappingCacheKey(areaId, fromBerth, berth, hints);
      let mapped = mapCache.get(mk);
      if (!mapped) {
        mapped = resolveTdMapping(catalog, { areaId, fromBerth }, berth, hints);
        mapCache.set(mk, mapped);
      }
      const { tiploc, crs, platform } = mapped;
      if (!tiploc) continue;

      const actual = parsed.time ? hhmm(parsed.time) : hhmmLondon(row.received_at);
      for (const passRid of ridsForTdPass(db, headcode, tiploc, forcedRid)) {
        upsertTdPass(db, { rid: passRid, tiploc, crs, platform, actual });
        applied++;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    db.close();
    catalog.close();
    throw err;
  }

  db.close();
  catalog.close();
  return { applied, total };
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

const runningAsCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/td-apply.js");
if (runningAsCli) {
  const ymd = process.argv[2] || operatingDayYmd();
  const arg = process.argv[3] || null;
  const DATA_DIR = process.env.DATA_DIR ?? "./data";
  const opts = {};
  if (arg) {
    if (/^\d{15}$/.test(arg)) opts.rid = arg;
    else opts.headcode = arg;
  }
  const out = replayTdEventsForDay(DATA_DIR, ymd, opts);
  const tag = opts.rid ? ` rid=${opts.rid}` : opts.headcode ? ` headcode=${opts.headcode}` : "";
  console.log(`td-replay ${ymd}${tag} applied=${out.applied} total=${out.total}`);
}
