import sqlite3
from pathlib import Path

db = sqlite3.connect("file:/home/darwin/rail-core/data/day-2026-10-30.sqlite?mode=ro", uri=True)
db.row_factory = sqlite3.Row
rid = "202610306704570"
rows = db.execute(
    """
    SELECT seq, tiploc, crs, is_passing, sta, std, wta, wtd, ata, atd, actual_source, live_kind
    FROM calls WHERE rid=?
    ORDER BY seq
    """,
    (rid,),
).fetchall()
print("raw", len(rows))
for r in rows:
    if r["is_passing"]:
        continue
    print(
        f"{r['seq']:4} {r['tiploc']:10} {r['crs'] or '':3} std={r['std']} sta={r['sta']} wtd={r['wtd']} wta={r['wta']} src={r['actual_source']} kind={r['live_kind']}"
    )
