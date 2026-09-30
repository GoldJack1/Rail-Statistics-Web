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

CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT NOT NULL,
  operating_day TEXT NOT NULL,
  rid TEXT,
  toc TEXT,
  headcode TEXT,
  diagram TEXT,
  PRIMARY KEY (unit_id, operating_day, rid)
);

CREATE INDEX IF NOT EXISTS idx_units_day ON units (operating_day, unit_id);

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

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rtppm (
  snapshot_at INTEGER PRIMARY KEY,
  json TEXT NOT NULL
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
