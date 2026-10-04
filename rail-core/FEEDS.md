# Feeds (live rail-core)

| Product | Used |
| --- | --- |
| Darwin Push Port | Kafka → ingest → today’s `calls` |
| TRUST | STOMP `TRAIN_MVT_ALL_TOC` → `/ingest/trust` (live overlay on calls) |
| VSTP | STOMP `VSTP_ALL` → `/ingest/vstp` (same-day STP WTT onto Darwin UID) |
| TD | STOMP `TD_ALL_SIG_AREA` → `/ingest/td` (berth by headcode; SMART→STANOX→CORPUS TIPLOC when mapped) |
| SMART | NROD `SupportingFileAuthenticate?type=SMART` → catalog `smart_steps` (after CORPUS) |
| ITPS SCHEDULE | **~06:30 Europe/London** NROD daily **JSON** full; CIF weekly+update fallback. Overlay WTT spine, then **ORM path stitch** + along-track mileage |
| TIPLOC geo | `tt/ref/tiplocs-merged.csv` (+ NaPTAN gap-fill) → catalog `tiploc_geo` |
| ORM path | catalog `orm_edges` (schedule tipoc pairs + geo kNN); stitches junction tipocs between known spine tipocs only |
| PTAC | Kafka → `/ingest/unit` → catalog `consists` keyed **UID + SSD** |
| PPTimetable | 04:00 **Europe/London** `DARWINTTFILES/PPTimetable` |
| RDM NLC / CORPUS | after v8 import succeeds |
| TOPS locations | after v8 import succeeds |
| Long-range CIF | after v8: `timetable_full.zip` into **future** day files only |
| HSP | overnight seal + background fill for historical public actuals |

### Path sources (detailed calling pattern)
A tipoc may appear only if it is on the **ITPS/VSTP spine**, reported by **TRUST**, or mapped from a **TD berth via SMART→STANOX→CORPUS**. ORM orders/fills **along the rail graph between those known tipocs** (junction tipocs with geo)—never free CRS station inventing. Legacy `TT_GEOM_DENSIFY` / `TT_GRAPH_FILL` stay **off** (escape hatch only).

Per-stop `legMiles` / `cumMiles` are along-ORM-path UK miles (omitted when no path for that gap).

### ITPS publish times (NROD wiki)
- **CIF**: ~**01:00 UTC** (weekly full Fridays + daily updates).
- **JSON**: ~**06:00 UTC** daily full snapshot (preferred; ~07:00 UK in BST).
- Darwin v8 stays at **04:00 UK**. ITPS overlay runs on **`rail-core-schedule.timer` at 06:30 UK** (retries until JSON lands).

Location boards use **Europe/London calendar dates** (Realtime Trains). Default board is a working line-up (passes, freight, TRUST). CIS passenger boards: `?passengers=1`.

Publish from the RDM download folder:

```
./rail-core/scripts/publish-rdm-files.sh ~/Downloads
```
