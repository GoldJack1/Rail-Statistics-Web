import sqlite3
from pathlib import Path

def show(day, rid):
    p = Path("/home/darwin/rail-core/data") / f"day-{day}.sqlite"
    print("\n====", day, rid, "====")
    if not p.exists():
        print("missing")
        return
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """
        SELECT category, main_rid, assoc_rid, tiploc, is_cancelled, is_deleted
        FROM associations
        WHERE main_rid = ? OR assoc_rid = ?
        """,
        (rid, rid),
    ).fetchall()
    print("stored", len(rows))
    for r in rows:
        print(dict(r))

for day, rid in [
    ("2026-10-30", "202610306704570"),
    ("2026-10-29", "202610296704568"),
    ("2026-10-30", "202610296704568"),
    ("2026-10-31", "202610316704544"),
    ("2026-10-30", "202610306704576"),
]:
    show(day, rid)
