import sqlite3

db = sqlite3.connect("file:/home/darwin/rail-core/data/day-2026-10-30.sqlite?mode=ro", uri=True)
rid = "202610306704570"
rows = db.execute(
    "SELECT seq, tiploc, is_passing, std, sta, wtd, wta FROM calls WHERE rid=? ORDER BY seq",
    (rid,),
).fetchall()
for seq, tpl, passing, std, sta, wtd, wta in rows:
    mark = "P" if passing else "S"
    t = std or sta or wtd or wta or ""
    print(f"{seq:4} {mark} {tpl:12} {t}")
