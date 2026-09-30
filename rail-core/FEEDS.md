# NRDP vs RDM vs NR Open Data

| Product | Source | Where used |
| --- | --- | --- |
| Darwin Push Port | RDM Kafka | rail-core ingest (live CIS) |
| HSP serviceMetrics / Details | **NRDP** (`SOURCE_HSP=nrdp`) | seal-day stop actuals |
| CIF / timetable files | **NRDP** (`SOURCE_TIMETABLE=nrdp`) | future `/api/window` |
| Knowledgebase Stations / Incidents / NSI | RDM until NRDP equivalents exist | Next.js `/api/knowledgebase/*` |
| RTPPM_ALL | Network Rail Open Data STOMP | ingest `/ingest/rtppm` |
| TRAIN_MVT_ALL_TOC (TRUST) | Network Rail Open Data STOMP | freight / gap actuals |
| CORPUS | Network Rail | catalog.sqlite tiploc map |
| TfL Unified | TfL app key | Next.js `/api/tfl` |
| PTAC | existing Kafka | catalog + per-day units |

Do not commit passwords. Copy PTAC SQLite before wipe. Do not run `wipe-old-darwin.sh` until Paddington live + dated boards on rail-core succeed.
