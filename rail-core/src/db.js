import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(ROOT, "schema-day.sql"), "utf8");

export function dayPath(dataDir, ymd) {
  return join(dataDir, `day-${ymd}.sqlite`);
}

export function openDayDb(dataDir, ymd) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dayPath(dataDir, ymd));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
  db.exec(SCHEMA);
  return db;
}

export function openCatalog(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "catalog.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
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
      stanox TEXT PRIMARY KEY,
      tiploc TEXT,
      crs TEXT,
      name TEXT
    );
  `);
  return db;
}

export function operatingDayYmd(now = new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
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

export function hhmm(value) {
  if (!value) return null;
  const s = String(value).replace(/\D/g, "").slice(0, 4);
  if (s.length < 4) return null;
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
}

export function liveKind({ ata, atd, atp, eta, etd, etp }) {
  if (ata || atd || atp) return "actual";
  if (eta || etd || etp) return "working";
  return "scheduled";
}

export function upsertService(db, row) {
  db.prepare(
    `INSERT INTO services (rid, uid, train_id, rs_id, toc, operator_name, origin_crs, origin_name,
      destination_crs, destination_name, via, service_type, cancelled, cancel_reason, delay_reason,
      is_charter, category, headcode, updated_at)
     VALUES (@rid, @uid, @train_id, @rs_id, @toc, @operator_name, @origin_crs, @origin_name,
      @destination_crs, @destination_name, @via, @service_type, @cancelled, @cancel_reason, @delay_reason,
      @is_charter, @category, @headcode, @updated_at)
     ON CONFLICT(rid) DO UPDATE SET
      uid=excluded.uid, train_id=excluded.train_id, rs_id=excluded.rs_id, toc=excluded.toc,
      operator_name=excluded.operator_name, origin_crs=excluded.origin_crs, origin_name=excluded.origin_name,
      destination_crs=excluded.destination_crs, destination_name=excluded.destination_name, via=excluded.via,
      service_type=excluded.service_type, cancelled=excluded.cancelled, cancel_reason=excluded.cancel_reason,
      delay_reason=excluded.delay_reason, is_charter=excluded.is_charter, category=excluded.category,
      headcode=excluded.headcode, updated_at=excluded.updated_at
     WHERE services.updated_at <= excluded.updated_at`
  ).run(row);
}

export function upsertCall(db, row) {
  db.prepare(
    `INSERT INTO calls (rid, tiploc, crs, seq, is_passing, cancelled, platform, length_cars, formation,
      sta, std, wta, wtd, wtp, ata, atd, atp, eta, etd, etp, delay_minutes, status, live_kind, actual_source, updated_at)
     VALUES (@rid, @tiploc, @crs, @seq, @is_passing, @cancelled, @platform, @length_cars, @formation,
      @sta, @std, @wta, @wtd, @wtp, @ata, @atd, @atp, @eta, @etd, @etp, @delay_minutes, @status, @live_kind, @actual_source, @updated_at)
     ON CONFLICT(rid, seq) DO UPDATE SET
      tiploc=excluded.tiploc, crs=excluded.crs, is_passing=excluded.is_passing, cancelled=excluded.cancelled,
      platform=excluded.platform, length_cars=excluded.length_cars, formation=excluded.formation,
      sta=COALESCE(excluded.sta, calls.sta), std=COALESCE(excluded.std, calls.std),
      wta=COALESCE(excluded.wta, calls.wta), wtd=COALESCE(excluded.wtd, calls.wtd), wtp=COALESCE(excluded.wtp, calls.wtp),
      ata=COALESCE(excluded.ata, calls.ata), atd=COALESCE(excluded.atd, calls.atd), atp=COALESCE(excluded.atp, calls.atp),
      eta=excluded.eta, etd=excluded.etd, etp=excluded.etp,
      delay_minutes=excluded.delay_minutes, status=excluded.status, live_kind=excluded.live_kind,
      actual_source=COALESCE(excluded.actual_source, calls.actual_source), updated_at=excluded.updated_at
     WHERE calls.updated_at <= excluded.updated_at`
  ).run(row);
}
