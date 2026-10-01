# rail-core — local query + history

Query `:4001` serves **today’s boards** and **dated day sqlite** (`?date=YYYY-MM-DD` or `/api/service/{rid}/{date}`).

## Local (ignore the VPS)

Credentials live in gitignored `.env` (`NRDP_HSP_*`, `NR_STOMP_*`).

```bash
cd rail-core
npm i
# seed station names
node src/import-crs-map.js data-seed/tiploc-crs.json
# HSP public actuals for a corridor (adds Darwin RIDs)
node src/history-day.js 2026-09-29 --from DEW --to MCV --from-time 1600 --to-time 1700
# query
npm run query
# curl "http://127.0.0.1:4001/api/service/202609297115813?date=2026-09-29"
```

Passing **actuals** need a timetable import for that RID (drop a `*v8.xml.gz` in `tt/` before `history-day`) and/or live TRUST:

```bash
npm run ingest   # terminal 1
npm run trust    # terminal 2 — TRAIN_MVT_ALL_TOC → /ingest/trust
```

HSP never writes pass rows. TRUST `PASS` and Darwin `PP` do.

## Feeds
- In: HSP (history), TRUST STOMP (live movements), optional Darwin Kafka / PPTimetable
- Out of scope for this local path: Caddy, VPS systemd
