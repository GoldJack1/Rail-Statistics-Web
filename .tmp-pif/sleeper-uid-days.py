import sqlite3
from pathlib import Path

base = Path("/home/darwin/rail-core/data")
uids = ("C04542", "C04544", "C04570", "C04568", "C04576", "C04578", "6704542", "6704568")
for day in ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]:
    p = base / f"day-{day}.sqlite"
    if not p.exists():
        continue
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    q = ",".join("?" * len(uids))
    rows = db.execute(
        f"""
        SELECT rid, uid, headcode,
          (SELECT COUNT(*) FROM calls c WHERE c.rid = services.rid AND (c.ata IS NOT NULL OR c.atd IS NOT NULL)) AS acts
        FROM services
        WHERE UPPER(IFNULL(uid,'')) IN ({q})
        ORDER BY rid
        """,
        uids,
    ).fetchall()
    print(day)
    for r in rows:
        print(" ", r)
