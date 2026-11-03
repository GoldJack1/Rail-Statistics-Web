import sqlite3
from datetime import datetime, timezone

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
rid = day.execute("SELECT rid, headcode FROM services WHERE uid='G89428'").fetchone()
print("service", rid)
calls = day.execute(
    "SELECT tiploc, ifnull(wtd,''), ifnull(wta,''), ifnull(wtp,'') FROM calls WHERE rid=? ORDER BY seq",
    (rid[0],),
).fetchall()
print("booked", [(c[0], c[1] or c[2] or c[3]) for c in calls if c[0] in ("LEEDS", "LINCLNC", "CHPLTWN", "WKFLDKG", "BNSLY")])
rows = day.execute(
    """SELECT received_at, tiploc FROM td_events
       WHERE headcode=? AND tiploc='CHPLTWN' ORDER BY received_at""",
    (rid[1],),
).fetchall()
for at, tiploc in rows:
    print(datetime.fromtimestamp(at / 1000, timezone.utc).strftime("%H:%M:%S"), tiploc)
