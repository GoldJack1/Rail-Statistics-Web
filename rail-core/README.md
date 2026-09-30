# rail-core (Realtime Trains-shaped ingest + query)

Greenfield VPS app. Do **not** copy overlay history or `departures-daemon.mjs`.

## Layout

- `src/ingest-server.js` — change-only Darwin XML / TRUST / RTPPM / unit POSTs
- `src/query-server.js` — `/api/departures/{CRS}?date=` `/api/service/{rid}/{date}` `/api/dates` `/api/units/` `/api/rtppm` `/api/window`
- `src/seal-day.js` — HSP fill of **stop** actuals; Darwin **pass** times kept
- `src/prune.js` — drop `day-*.sqlite` older than `RETENTION_DAYS` (30)
- `src/import-tt.js` / `src/import-corpus.js` — CIF timetable + CORPUS STANOX map
- `src/trust-apply.js` — TRUST movements upserted onto `calls` (not a raw archive)

## Deploy

1. Run `scripts/backup-ptac-from-vps.sh` from the website repo.
2. Copy this directory to `/home/darwin/rail-core`.
3. `cp .env.example .env` and fill Kafka / NR / HSP (never commit `.env`).
4. `node src/import-ptac.js /path/to/darwin-state.backup.sqlite`
5. systemd: `rail-core-query` on `:4001`, `rail-core-ingest` on `:4003`.
6. Point Caddy at query only. Keep `:4002` unused.
7. Prove Paddington live + dated boards, then `CONFIRM_DARWIN_WIPE=yes scripts/wipe-old-darwin.sh`.

## Kafka

Wire `kafkajs` (or existing consumer) to POST `/ingest/darwin` with raw PPort XML. Same-day writes only; no 30s snapshots.

## NR STOMP

Subscribe `RTPPM_ALL` and `TRAIN_MVT_ALL_TOC`; POST `/ingest/rtppm` and `/ingest/trust`.
