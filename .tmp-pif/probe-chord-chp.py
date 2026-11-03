import json
import math
import sqlite3

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
geo = {t.upper(): (e, n) for t, e, n in cat.execute("SELECT tiploc, easting, northing FROM tiploc_geo") if e is not None}

def extra(a, mid, b):
    pa, pm, pb = geo[a], geo[mid], geo[b]
    direct = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
    via = math.hypot(pa[0] - pm[0], pa[1] - pm[1]) + math.hypot(pm[0] - pb[0], pm[1] - pb[1])
    return round(via - direct), round(direct)

for mid in ("CHPLTWN", "WOMBWEL", "ELSC"):
    print(mid, "BNSLY-ECLSFLW", extra("BNSLY", mid, "ECLSFLW") if mid in geo else "no geo")
    print(mid, "BNSLY-MEADWHL", extra("BNSLY", mid, "MEADWHL") if mid in geo else "no geo")

row = day.execute(
    "SELECT json, received_at FROM td_events WHERE headcode='1L73' AND tiploc='CHPLTWN' ORDER BY received_at DESC LIMIT 1"
).fetchone()
body = json.loads(row[0])
print("keys", list(body))
inner = next(iter(body.values()))
print("time", inner.get("time"), inner.get("report_time"), "recv", row[1])
print("name", cat.execute("SELECT name, crs FROM corpus WHERE tiploc='CHPLTWN'").fetchone())
