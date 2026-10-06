import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sortCallsByJourneyTime, publicJourneyEnds } from "./journey-order.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(ROOT, "schema-day.sql"), "utf8");

export function dayPath(dataDir, ymd) {
  return join(dataDir, `day-${ymd}.sqlite`);
}

export function openDayDb(dataDir, ymd) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dayPath(dataDir, ymd));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=60000;");
  db.exec(SCHEMA);
  db.exec("CREATE INDEX IF NOT EXISTS idx_services_uid ON services (uid);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_units_rid ON units (rid);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_calls_tiploc_std ON calls (tiploc, std);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_services_headcode ON services (headcode);");
  ensureUnitJoinColumns(db);
  ensureServiceFormationColumn(db);
  ensureCallLoadingColumns(db);
  ensureCallMileageColumns(db);
  ensureAssociationsTable(db);
  ensureTdTables(db);
  return db;
}

function ensureTdTables(db) {
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

function ensureAssociationsTable(db) {
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

function ensureCallLoadingColumns(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(calls)`).all().map((c) => c.name));
  if (!cols.has("loading_percentage")) db.exec(`ALTER TABLE calls ADD COLUMN loading_percentage REAL`);
  if (!cols.has("coach_loading")) db.exec(`ALTER TABLE calls ADD COLUMN coach_loading TEXT`);
}

function ensureCallMileageColumns(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(calls)`).all().map((c) => c.name));
  if (!cols.has("leg_m")) db.exec(`ALTER TABLE calls ADD COLUMN leg_m REAL`);
  if (!cols.has("cum_m")) db.exec(`ALTER TABLE calls ADD COLUMN cum_m REAL`);
}

function ensureServiceFormationColumn(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(services)`).all().map((c) => c.name));
  if (!cols.has("formation")) db.exec(`ALTER TABLE services ADD COLUMN formation TEXT`);
}

function ensureUnitJoinColumns(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(units)`).all().map((c) => c.name));
  if (!cols.has("origin_tpl")) db.exec(`ALTER TABLE units ADD COLUMN origin_tpl TEXT`);
  if (!cols.has("origin_hhmm")) db.exec(`ALTER TABLE units ADD COLUMN origin_hhmm TEXT`);
}

export function walCheckpoint(db) {
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    /* ignore */
  }
}

export function openCatalog(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "catalog.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=60000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      unit_id TEXT PRIMARY KEY,
      class TEXT,
      operator TEXT,
      json TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tiploc (
      tiploc TEXT PRIMARY KEY,
      crs TEXT,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS corpus (
      tiploc TEXT PRIMARY KEY,
      stanox TEXT,
      crs TEXT,
      name TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_corpus_stanox ON corpus(stanox);
    CREATE INDEX IF NOT EXISTS idx_corpus_crs ON corpus(crs);
    CREATE INDEX IF NOT EXISTS idx_tiploc_crs ON tiploc(crs);
    CREATE TABLE IF NOT EXISTS consists (
      uid TEXT NOT NULL,
      ssd TEXT NOT NULL,
      origin_hhmm TEXT NOT NULL DEFAULT '',
      headcode TEXT,
      origin_tpl TEXT,
      unit_ids TEXT,
      json TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (uid, ssd, origin_hhmm)
    );
    CREATE INDEX IF NOT EXISTS idx_consists_ssd ON consists (ssd, headcode);
    CREATE TABLE IF NOT EXISTS tiploc_geo (
      tiploc TEXT PRIMARY KEY,
      easting REAL,
      northing REAL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      source TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tiploc_geo_latlon ON tiploc_geo (lat, lon);
  `);
  migrateCorpusTable(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_corpus_crs ON corpus(crs);
    CREATE INDEX IF NOT EXISTS idx_tiploc_crs ON tiploc(crs);
  `);
  return db;
}

function migrateCorpusTable(db) {
  const cols = db.prepare(`PRAGMA table_info(corpus)`).all();
  if (!cols.length) return;
  const pk = cols.find((c) => Number(c.pk) === 1);
  if (pk?.name === "tiploc") return;
  db.exec(`
    CREATE TABLE corpus_v2 (
      tiploc TEXT PRIMARY KEY,
      stanox TEXT,
      crs TEXT,
      name TEXT
    );
    INSERT OR IGNORE INTO corpus_v2 (tiploc, stanox, crs, name)
      SELECT UPPER(trim(tiploc)), stanox, crs, name
      FROM corpus
      WHERE tiploc IS NOT NULL AND trim(tiploc) != '';
    DROP TABLE corpus;
    ALTER TABLE corpus_v2 RENAME TO corpus;
    CREATE INDEX IF NOT EXISTS idx_corpus_stanox ON corpus(stanox);
  `);
}

export function operatingDayYmd(now = new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  let y = get("year");
  let m = get("month");
  let d = get("day");
  const hour = get("hour");
  const utc = Date.UTC(y, m - 1, d);
  const shifted = hour < 2 ? utc - 86400000 : utc;
  const dt = new Date(shifted);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function platformText(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    const inner = value["#text"] ?? value._ ?? value.text ?? value.value ?? value.plat;
    if (inner != null && typeof inner !== "object") {
      const s = String(inner).trim();
      return s && s !== "[object Object]" ? s : null;
    }
    return null;
  }
  const s = String(value).trim();
  if (!s || s === "[object Object]") return null;
  return s;
}

function formatHhmm(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false,
  }).formatToParts(date);
  const hh = parts.find((p) => p.type === "hour")?.value;
  const mm = parts.find((p) => p.type === "minute")?.value;
  if (hh == null || mm == null) return null;
  const hour = hh === "24" ? "00" : hh.padStart(2, "0");
  return `${hour}:${mm.padStart(2, "0")}`;
}

/** Real UTC instants (Date.now(), TD received_at). Follows BST/GMT, including clock changes. */
export function hhmmLondon(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const ms = n > 0 && n < 1e11 ? n * 1000 : n;
  if (ms <= 1e11) return null;
  return formatHhmm(new Date(ms), "Europe/London");
}

export function hhmm(value) {
  if (!value) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e11) {
    // TRUST actual_timestamp is a UK civil clock stored as a UTC epoch.
    // Formatting it in Europe/London adds a second hour during BST.
    return formatHhmm(new Date(n), "UTC");
  }
  const s = String(value).replace(/\D/g, "");
  if (s.length === 13 || s.length === 10) return hhmm(Number(s.length === 10 ? Number(s) * 1000 : s));
  const t = s.slice(0, 4);
  if (t.length < 4) return null;
  return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
}

export function liveKind({ ata, atd, atp, eta, etd, etp }) {
  if (ata || atd || atp) return "actual";
  if (eta || etd || etp) return "working";
  return "scheduled";
}

export function upsertService(db, row, opts = {}) {
  const overlay = Boolean(opts.overlay);
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, formation, updated_at)
     VALUES (@rid, @uid, @train_id, @rs_id, @toc, @operator_name, @origin_crs, @origin_name,
      @destination_crs, @destination_name, @via, @service_type, @cancelled, @cancel_reason, @delay_reason,
      @is_charter, @category, @headcode, @formation, @updated_at)
     ON CONFLICT(rid) DO UPDATE SET
      uid=COALESCE(NULLIF(excluded.uid,''), services.uid),
      train_id=COALESCE(NULLIF(excluded.train_id,''), services.train_id),
      rs_id=COALESCE(excluded.rs_id, services.rs_id),
      toc=${overlay ? "COALESCE(services.toc, excluded.toc)" : "COALESCE(NULLIF(excluded.toc,''), services.toc)"},
      operator_name=${overlay ? "COALESCE(services.operator_name, excluded.operator_name)" : "COALESCE(NULLIF(excluded.operator_name,''), services.operator_name)"},
      origin_crs=${overlay ? "COALESCE(services.origin_crs, excluded.origin_crs)" : "COALESCE(NULLIF(excluded.origin_crs,''), services.origin_crs)"},
      origin_name=${overlay ? "COALESCE(services.origin_name, excluded.origin_name)" : "COALESCE(NULLIF(excluded.origin_name,''), services.origin_name)"},
      destination_crs=${overlay ? "COALESCE(services.destination_crs, excluded.destination_crs)" : "COALESCE(NULLIF(excluded.destination_crs,''), services.destination_crs)"},
      destination_name=${overlay ? "COALESCE(services.destination_name, excluded.destination_name)" : "COALESCE(NULLIF(excluded.destination_name,''), services.destination_name)"},
      via=COALESCE(excluded.via, services.via),
      cancelled=excluded.cancelled,
      cancel_reason=COALESCE(excluded.cancel_reason, services.cancel_reason),
      delay_reason=COALESCE(excluded.delay_reason, services.delay_reason),
      category=COALESCE(excluded.category, services.category),
      headcode=COALESCE(NULLIF(excluded.headcode,''), services.headcode),
      formation=COALESCE(excluded.formation, services.formation),
      updated_at=excluded.updated_at`
  ).run({ ...row, formation: row.formation ?? null });
}

export function upsertCall(db, row, opts = {}) {
  if (!row?.rid) return;
  const overlay = Boolean(opts.overlay);
  let existing = row.tiploc
    ? db.prepare(`SELECT seq, tiploc FROM calls WHERE rid = ? AND tiploc = ?`).get(row.rid, row.tiploc)
    : null;
  if (!existing && row.crs) {
    existing = db
      .prepare(
        `SELECT seq, tiploc FROM calls
         WHERE rid = ? AND UPPER(IFNULL(crs,'')) = ? AND IFNULL(is_passing, 0) = 0
         LIMIT 1`,
      )
      .get(row.rid, String(row.crs).toUpperCase());
  }
  if (overlay && !existing) return;
  const tiploc = existing?.tiploc || row.tiploc;
  if (!tiploc) return;
  const seq = existing
    ? existing.seq
    : db.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM calls WHERE rid = ?`).get(row.rid).n;
  const payload = {
    rid: row.rid,
    tiploc,
    crs: row.crs ?? null,
    seq,
    is_passing: row.is_passing ? 1 : 0,
    cancelled: row.cancelled ? 1 : 0,
    platform: platformText(row.platform),
    length_cars: row.length_cars ?? null,
    formation: row.formation ?? null,
    loading_percentage: row.loading_percentage ?? null,
    coach_loading: row.coach_loading ?? null,
    sta: row.sta ?? null,
    std: row.std ?? null,
    wta: row.wta ?? null,
    wtd: row.wtd ?? null,
    wtp: row.wtp ?? null,
    ata: row.ata ?? null,
    atd: row.atd ?? null,
    atp: row.atp ?? null,
    eta: row.eta ?? null,
    etd: row.etd ?? null,
    etp: row.etp ?? null,
    delay_minutes: row.delay_minutes ?? null,
    status: row.status ?? null,
    live_kind: row.live_kind ?? "scheduled",
    actual_source: row.actual_source ?? null,
    leg_m: row.leg_m ?? null,
    cum_m: row.cum_m ?? null,
    updated_at: row.updated_at ?? Date.now(),
  };
  if (existing) {
    if (opts.cifMerge) {
      db.prepare(
        `UPDATE calls SET
          crs=COALESCE(crs, @crs),
          wta=COALESCE(wta, @wta), wtd=COALESCE(wtd, @wtd), wtp=COALESCE(wtp, @wtp),
          sta=COALESCE(sta, @sta), std=COALESCE(std, @std),
          platform=COALESCE(platform, @platform)
         WHERE rid=@rid AND tiploc=@tiploc`,
      ).run({
        rid: payload.rid,
        tiploc: payload.tiploc,
        crs: payload.crs,
        wta: payload.wta,
        wtd: payload.wtd,
        wtp: payload.wtp,
        sta: payload.sta,
        std: payload.std,
        platform: payload.platform,
      });
      return;
    }
    if (overlay) {
      const fill = Boolean(opts.fillOnly);
      db.prepare(
        `UPDATE calls SET
          crs=COALESCE(crs, @crs),
          cancelled=@cancelled,
          platform=COALESCE(@platform, CASE WHEN platform = '[object Object]' THEN NULL ELSE platform END),
          ata=${fill ? "COALESCE(ata, @ata)" : "COALESCE(@ata, ata)"},
          atd=${fill ? "COALESCE(atd, @atd)" : "COALESCE(@atd, atd)"},
          atp=${fill ? "COALESCE(atp, @atp)" : "COALESCE(@atp, atp)"},
          eta=${fill ? "COALESCE(eta, @eta)" : "COALESCE(@eta, eta)"},
          etd=${fill ? "COALESCE(etd, @etd)" : "COALESCE(@etd, etd)"},
          etp=${fill ? "COALESCE(etp, @etp)" : "COALESCE(@etp, etp)"},
          loading_percentage=COALESCE(@loading_percentage, loading_percentage),
          coach_loading=COALESCE(@coach_loading, coach_loading),
          live_kind=CASE
            WHEN @ata IS NOT NULL OR @atd IS NOT NULL OR @atp IS NOT NULL
              OR @eta IS NOT NULL OR @etd IS NOT NULL OR @etp IS NOT NULL
            THEN @live_kind ELSE live_kind END,
          actual_source=${
            fill
              ? `CASE
            WHEN @actual_source IS NOT NULL
              AND (@ata IS NOT NULL OR @atd IS NOT NULL OR @atp IS NOT NULL
                OR @eta IS NOT NULL OR @etd IS NOT NULL OR @etp IS NOT NULL)
            THEN @actual_source
            ELSE COALESCE(actual_source, @actual_source) END`
              : "COALESCE(@actual_source, actual_source)"
          },
          updated_at=@updated_at
         WHERE rid=@rid AND tiploc=@tiploc`
      ).run({
        rid: payload.rid,
        tiploc: payload.tiploc,
        crs: payload.crs,
        cancelled: payload.cancelled,
        platform: payload.platform,
        ata: payload.ata,
        atd: payload.atd,
        atp: payload.atp,
        eta: payload.eta,
        etd: payload.etd,
        etp: payload.etp,
        loading_percentage: payload.loading_percentage,
        coach_loading: payload.coach_loading,
        live_kind: payload.live_kind,
        actual_source: payload.actual_source,
        updated_at: payload.updated_at,
      });
      return;
    }
    db.prepare(
      `UPDATE calls SET
        crs=COALESCE(@crs, crs),
        is_passing=@is_passing,
        cancelled=@cancelled,
        platform=COALESCE(@platform, CASE WHEN platform = '[object Object]' THEN NULL ELSE platform END),
        length_cars=COALESCE(@length_cars, length_cars),
        formation=COALESCE(@formation, formation),
        sta=COALESCE(@sta, sta), std=COALESCE(@std, std),
        wta=COALESCE(@wta, wta), wtd=COALESCE(@wtd, wtd), wtp=COALESCE(@wtp, wtp),
        ata=COALESCE(@ata, ata), atd=COALESCE(@atd, atd), atp=COALESCE(@atp, atp),
        eta=@eta, etd=@etd, etp=@etp,
        loading_percentage=COALESCE(@loading_percentage, loading_percentage),
        coach_loading=COALESCE(@coach_loading, coach_loading),
        delay_minutes=@delay_minutes, status=@status, live_kind=@live_kind,
        actual_source=COALESCE(@actual_source, actual_source),
        leg_m=COALESCE(@leg_m, leg_m), cum_m=COALESCE(@cum_m, cum_m),
        updated_at=@updated_at
       WHERE rid=@rid AND tiploc=@tiploc`
    ).run({
      rid: payload.rid,
      tiploc: payload.tiploc,
      crs: payload.crs,
      is_passing: payload.is_passing,
      cancelled: payload.cancelled,
      platform: payload.platform,
      length_cars: payload.length_cars,
      formation: payload.formation,
      sta: payload.sta,
      std: payload.std,
      wta: payload.wta,
      wtd: payload.wtd,
      wtp: payload.wtp,
      ata: payload.ata,
      atd: payload.atd,
      atp: payload.atp,
      eta: payload.eta,
      etd: payload.etd,
      etp: payload.etp,
      loading_percentage: payload.loading_percentage,
      coach_loading: payload.coach_loading,
      delay_minutes: payload.delay_minutes,
      status: payload.status,
      live_kind: payload.live_kind,
      actual_source: payload.actual_source,
      leg_m: payload.leg_m,
      cum_m: payload.cum_m,
      updated_at: payload.updated_at,
    });
    return;
  }
  db.prepare(
    `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, platform, length_cars, formation,
      loading_percentage, coach_loading,
      sta, std, wta, wtd, wtp, ata, atd, atp, eta, etd, etp, delay_minutes, status, live_kind, actual_source,
      leg_m, cum_m, updated_at)
     VALUES (@rid, @tiploc, @crs, @seq, @is_passing, @cancelled, @platform, @length_cars, @formation,
      @loading_percentage, @coach_loading,
      @sta, @std, @wta, @wtd, @wtp, @ata, @atd, @atp, @eta, @etd, @etp, @delay_minutes, @status, @live_kind, @actual_source,
      @leg_m, @cum_m, @updated_at)`
  ).run(payload);
}

export function adoptUidOntoRid(db, uid, rid) {
  if (!uid || !rid) return;
  const darwinRid = /^\d{15}$/.test(String(rid));
  if (!darwinRid) return;
  const others = db.prepare(`SELECT * FROM services WHERE uid = ? AND rid != ?`).all(uid, rid);
  for (const o of others) {
    if (/^\d{15}$/.test(String(o.rid))) continue;
    // Copy CIF identity onto the Darwin stub before dropping the CIF RID —
    // otherwise overnight CS portions keep null toc/headcode after adoption.
    db.prepare(
      `UPDATE services SET
         train_id = COALESCE(NULLIF(train_id,''), ?),
         toc = COALESCE(NULLIF(toc,''), ?),
         operator_name = COALESCE(NULLIF(operator_name,''), ?),
         category = COALESCE(NULLIF(category,''), ?),
         headcode = COALESCE(NULLIF(headcode,''), ?),
         origin_crs = COALESCE(NULLIF(origin_crs,''), ?),
         origin_name = COALESCE(NULLIF(origin_name,''), ?),
         destination_crs = COALESCE(NULLIF(destination_crs,''), ?),
         destination_name = COALESCE(NULLIF(destination_name,''), ?),
         service_type = COALESCE(NULLIF(service_type,''), ?)
       WHERE rid = ?`,
    ).run(
      o.train_id || null,
      o.toc || null,
      o.operator_name || null,
      o.category || null,
      o.headcode || o.train_id || null,
      o.origin_crs || null,
      o.origin_name || null,
      o.destination_crs || null,
      o.destination_name || null,
      o.service_type || null,
      rid,
    );
    const calls = db.prepare(`SELECT * FROM calls WHERE rid = ?`).all(o.rid);
    for (const c of calls) upsertCall(db, { ...c, rid }, { cifMerge: true });
    db.prepare(`DELETE FROM calls WHERE rid = ?`).run(o.rid);
    db.prepare(`DELETE FROM services WHERE rid = ?`).run(o.rid);
  }
}

export function refreshServiceJourney(db, rid, lookupName) {
  const raw = db
    .prepare(
      `SELECT crs, tiploc, seq, sta, std, wta, wtd, wtp, is_passing FROM calls
       WHERE rid = ? AND IFNULL(is_passing, 0) = 0`,
    )
    .all(rid);
  const { origin, dest } = publicJourneyEnds(raw);
  if (!origin || !dest) return;
  const originName = lookupName ? lookupName(origin.crs, origin.tiploc) : null;
  const destName = lookupName ? lookupName(dest.crs, dest.tiploc) : null;
  db.prepare(
    `UPDATE services SET origin_crs = ?, origin_name = COALESCE(?, origin_name),
      destination_crs = ?, destination_name = COALESCE(?, ?) WHERE rid = ?`
  ).run(origin.crs, originName, dest.crs, destName, dest.tiploc, rid);
}

function deleteRids(db, extra) {
  if (!extra.length) return { services: 0, calls: 0 };
  const delCalls = db.prepare(`DELETE FROM calls WHERE rid = ?`);
  const delSvc = db.prepare(`DELETE FROM services WHERE rid = ?`);
  let calls = 0;
  db.exec("BEGIN");
  for (const row of extra) {
    calls += delCalls.run(row.rid).changes;
    delSvc.run(row.rid);
  }
  db.exec("COMMIT");
  return { services: extra.length, calls };
}

/** Drop CIF/DTD rows whose RID date is after this day file (next-day ghosts). */
export function pruneFutureDayRids(db, ymd) {
  const compact = String(ymd || "").replace(/-/g, "");
  if (!/^\d{8}$/.test(compact)) return { services: 0, calls: 0 };
  const extra = db.prepare(`SELECT rid FROM services WHERE substr(rid, 1, 8) > ?`).all(compact);
  return deleteRids(db, extra);
}

/** YYYYMMDD+UID stubs left on a Darwin operating day (no 15-digit RID). */
export function pruneCifUidStubRids(db) {
  const hasDarwin = db
    .prepare(
      `SELECT 1 AS ok FROM services WHERE rid GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' LIMIT 1`,
    )
    .get();
  if (!hasDarwin) return { services: 0, calls: 0 };
  const extra = db
    .prepare(
      `SELECT rid FROM services WHERE rid NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`,
    )
    .all();
  return deleteRids(db, extra);
}

export function snapshotCallLive(db, rid) {
  return db
    .prepare(
      `SELECT tiploc, ata, atd, atp, eta, etd, etp, live_kind, actual_source, platform
       FROM calls WHERE rid = ?
         AND (ata IS NOT NULL OR atd IS NOT NULL OR atp IS NOT NULL
           OR eta IS NOT NULL OR etd IS NOT NULL OR etp IS NOT NULL)`,
    )
    .all(rid);
}

export function restoreCallLive(db, rid, rows) {
  const stmt = db.prepare(
    `UPDATE calls SET
        ata=COALESCE(@ata, ata), atd=COALESCE(@atd, atd), atp=COALESCE(@atp, atp),
        eta=COALESCE(@eta, eta), etd=COALESCE(@etd, etd), etp=COALESCE(@etp, etp),
        live_kind=COALESCE(@live_kind, live_kind),
        actual_source=COALESCE(@actual_source, actual_source),
        platform=COALESCE(@platform, platform)
     WHERE rid=@rid AND tiploc=@tiploc`,
  );
  for (const row of rows || []) stmt.run({ ...row, rid });
}
