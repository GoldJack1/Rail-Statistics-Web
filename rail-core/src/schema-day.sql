-- rail-core per-day schema (plus catalog.sqlite)

CREATE TABLE IF NOT EXISTS services (
  rid TEXT PRIMARY KEY,
  uid TEXT,
  train_id TEXT,
  rs_id TEXT,
  toc TEXT,
  operator_name TEXT,
  origin_crs TEXT,
  origin_name TEXT,
  destination_crs TEXT,
  destination_name TEXT,
  via TEXT,
  service_type TEXT NOT NULL DEFAULT 'passenger',
  cancelled INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  delay_reason TEXT,
  is_charter INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  headcode TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  rid TEXT NOT NULL,
  tiploc TEXT NOT NULL,
  crs TEXT,
  seq INTEGER NOT NULL,
  is_passing INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  length_cars INTEGER,
  formation TEXT,
  sta TEXT,
  std TEXT,
  wta TEXT,
  wtd TEXT,
  wtp TEXT,
  ata TEXT,
  atd TEXT,
  atp TEXT,
  eta TEXT,
  etd TEXT,
  etp TEXT,
  loading_percentage REAL,
  coach_loading TEXT,
  delay_minutes INTEGER,
  status TEXT,
  live_kind TEXT NOT NULL DEFAULT 'scheduled',
  actual_source TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (rid, seq)
);

CREATE INDEX IF NOT EXISTS idx_calls_crs_std ON calls (crs, std);
CREATE INDEX IF NOT EXISTS idx_calls_crs_sta ON calls (crs, sta);
CREATE INDEX IF NOT EXISTS idx_calls_rid ON calls (rid);
CREATE INDEX IF NOT EXISTS idx_services_uid ON services (uid);

CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT NOT NULL,
  operating_day TEXT NOT NULL,
  rid TEXT,
  toc TEXT,
  headcode TEXT,
  diagram TEXT,
  origin_tpl TEXT,
  origin_hhmm TEXT,
  PRIMARY KEY (unit_id, operating_day, rid)
);

CREATE INDEX IF NOT EXISTS idx_units_day ON units (operating_day, unit_id);
CREATE INDEX IF NOT EXISTS idx_units_rid ON units (rid);
CREATE INDEX IF NOT EXISTS idx_calls_tiploc_std ON calls (tiploc, std);
CREATE INDEX IF NOT EXISTS idx_services_headcode ON services (headcode);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  category TEXT,
  severity TEXT,
  stations TEXT,
  body TEXT,
  starts_at TEXT,
  ends_at TEXT,
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rtppm (
  snapshot_at INTEGER PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_trains (
  train_id TEXT PRIMARY KEY,
  uid TEXT,
  toc_id TEXT,
  activated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_events (
  event_id TEXT PRIMARY KEY,
  train_id TEXT,
  uid TEXT,
  loc_stanox TEXT,
  event_type TEXT,
  planned TEXT,
  actual TEXT,
  json TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trust_train ON trust_events (train_id, received_at);
