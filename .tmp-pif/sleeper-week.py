import sqlite3
from pathlib import Path

base = Path("/home/darwin/rail-core/data")
for day in ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]:
    p = base / f"day-{day}.sqlite"
    if not p.exists():
        print(day, "missing")
        continue
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    rows = db.execute(
        """
        SELECT rid, uid, headcode FROM services
        WHERE headcode='1S25' AND rid LIKE ?
        """,
        (day.replace("-", "") + "%",),
    ).fetchall()
    print("\n", day, "1S25", rows)
    for rid, uid, hc in rows:
        calls = db.execute(
            """
            SELECT COALESCE(crs, substr(tiploc,1,6)) FROM calls
            WHERE rid=? AND IFNULL(is_passing,0)=0 ORDER BY seq
            """,
            (rid,),
        ).fetchall()
        print(" ", rid, uid, " ".join(c[0] for c in calls))
