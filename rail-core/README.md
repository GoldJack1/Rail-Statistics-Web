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

## VPS prod + staging query

One ingest and one `DATA_DIR`. Staging is a second query process only:

- prod: `rail-core-query` `:4001` → `api-raildata.railstatistics.co.uk`
- staging: `/home/darwin/rail-core-dev` + `rail-core-query-dev` `:4002` → `api-dev.railstatistics.co.uk`
- `QUERY_READ_ONLY=1` on staging (no `ensureDayImported` / `persistInferred` / HSP fill writes)
- systemd `EnvironmentFile=/home/darwin/rail-core-dev/.env` (prod secrets plus `QUERY_PORT=4002`; do not point the staging unit at prod `.env` or it stays on `:4001`)

Promote query code (does **not** restart ingest/kafka/stomp/tt):

```bash
sudo /home/darwin/rail-core/scripts/promote-query-dev.sh
```

## Platform positions (quai)

`GET /api/platforms?at=id~lat~lng~platform|…` places booked platforms for the service map.
It asks [quai](https://github.com/simfr24/trainlog_quai), Trainlog's station index built from
OpenStreetMap, at `QUAI_URL` (default `http://127.0.0.1:5020`). Both query processes share it.

- On the VPS: `/home/darwin/quai`, Docker, API `127.0.0.1:5020`, database `127.0.0.1:5433`.
  `docker-compose.override.yml` keeps its build on cores 4-7.
- Refresh GB from OSM: `cd /home/darwin/quai && QUAI_CORES=4 QUAI_SHARED_BUFFERS=2GB make all REGIONS=europe/great-britain`
- A call with no booked platform asks for `id~lat~lng~left@<bearing>`, the direction of travel in degrees
  from north. `src/left-hand-road.js` answers with the left-hand road of the through pair, marked `guess`.
- `src/quai-platforms-core.js` is built from `new-site/src/utils/quaiPlatforms.ts` (command at its top).

The service map line is drawn by `POST /api/service-route` (`src/service-route.js`), for the website and the iOS app alike:

- Body: `{ toc, stops: [{ index, lat, lng, crs, tpl, calling, kind, cancelled, platform, path, line }], draft? }`. The stops are the timing points the client has placed on the map.
- Answer: `path` (`[lat, lng]` pairs, or null), `booked` (platforms a rule changed), `platforms`, `marks` (the point each stop is routed through), `markers` (where each dot is drawn) and `complete`.
- Every routing decision is made here: the platform rules, the left-hand road, which points the line passes and the correction of a point on the wrong track. `draft: true` answers with the first line, before that correction.
- The track geometry between the points comes from `RAIL_ROUTE_URL`, the site's `/api/rail-route`. It defaults to the beta site on the dev server and the main site on the live one. Routes are kept for 30 minutes.

Manual tweaks live in `config/` and are read on each request, so editing them does not need a site deploy or a query restart:

- `config/platform-rules.json` chooses the platform a service is routed through (Mirfield, Morley, Shipley). `POST /api/service-route` applies it; the site and the app keep no copy. `GET /api/platform-rules` still serves the list.
- `config/platform-fixes.json` places a platform on a measured rail. Huddersfield 1, 2 and 3 are a station block there: quai's old 1–4B are dropped, and a booking of 4, 4A or 4B uses platform 3. A one-off stand is `{ "near": [lat, lng], "withinM": 500, "ref": "1", "lat": 53.64, "lng": -1.78 }`. `/api/platforms` itself is cached for an hour.
