# Feeds (live rail-core)

| Product | Used |
| --- | --- |
| Darwin Push Port | Kafka → ingest → today’s `calls` |
| TRUST | STOMP `TRAIN_MVT_ALL_TOC` → `/ingest/trust` (live overlay on calls) |
| PTAC | Kafka → `/ingest/unit` → catalog `consists` keyed **UID + SSD** (joined at query time) |
| PPTimetable | 04:00 **Europe/London** `DARWINTTFILES/PPTimetable` (retry ~35m until today’s v8) |
| RDM NLC / CORPUS | after v8 import succeeds |
| TOPS locations | after v8 import succeeds |
| Long-range CIF | after v8: `timetable_full.zip` into **future** day files only (never today’s Darwin timetable) |
| HSP | overnight seal + background fill for historical public actuals |

Location boards use **Europe/London calendar dates** (Realtime Trains). Default board is a working line-up (passes, freight, TRUST). CIS passenger boards: `?passengers=1`.

Publish from the RDM download folder:

```
./rail-core/scripts/publish-rdm-files.sh ~/Downloads
```
