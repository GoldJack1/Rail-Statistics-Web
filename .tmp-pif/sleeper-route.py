import json
import sqlite3

db = sqlite3.connect("file:/home/darwin/rail-core/data/day-2026-10-30.sqlite?mode=ro", uri=True)
db.row_factory = sqlite3.Row
print("CS passenger with public calls tonight file, rid date >= 20261030")
rows = db.execute(
    """
    SELECT rid, uid, headcode, origin_name, destination_name
    FROM services
    WHERE UPPER(IFNULL(toc,''))='CS'
      AND rid LIKE '20261030%'
      AND headcode LIKE '1%'
    ORDER BY headcode, rid
    """
).fetchall()
for r in rows:
    calls = db.execute(
        """
        SELECT tiploc, crs, std, sta FROM calls
        WHERE rid=? AND IFNULL(is_passing,0)=0
        ORDER BY seq
        """,
        (r["rid"],),
    ).fetchall()
    path = " ".join((c["crs"] or c["tiploc"][:6]) for c in calls[:8])
    end = " ".join((c["crs"] or c["tiploc"][:6]) for c in calls[-4:])
    print(f"{r['headcode']} {r['rid']} uid={r['uid']} n={len(calls)} {path} ... {end}")

svc = db.execute("SELECT schedule_json FROM services WHERE rid='202610306704570'").fetchone()
raw = svc["schedule_json"] if svc else None
print("\nschedule_json", "none" if not raw else f"{len(raw)} bytes")
if raw:
    data = json.loads(raw)
    print("keys", list(data)[:20] if isinstance(data, dict) else type(data))
    if isinstance(data, dict):
        locs = data.get("locations") or data.get("schedule") or data.get("stops")
        print("loc type", type(locs).__name__, "len", len(locs) if hasattr(locs, "__len__") else None)
        if isinstance(locs, list):
            for loc in locs:
                if not isinstance(loc, dict):
                    continue
                tpl = loc.get("tiploc") or loc.get("tpl") or loc.get("location")
                pub = loc.get("public_departure") or loc.get("publicDeparture") or loc.get("ptd") or loc.get("std")
                if loc.get("pass") or loc.get("is_passing"):
                    continue
                print(" ", tpl, pub or loc.get("departure") or loc.get("arrival"))
