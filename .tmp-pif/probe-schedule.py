import json
import sqlite3

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
row = day.execute("SELECT schedule_json FROM services WHERE uid='W33928'").fetchone()
text = row[0] or ""
print("len", len(text))
for token in ("CHDNGTN", "CED", "BODORGN", "RHOSNGR", "TYCROES", "QPRK"):
    print(token, token in text)
# how calls are built: count pass vs stop
rid = day.execute("SELECT rid FROM services WHERE uid='W33928'").fetchone()[0]
print("calls", day.execute("SELECT count(*) FROM calls WHERE rid=?", (rid,)).fetchone()[0])
print("cols", [r[1] for r in day.execute("PRAGMA table_info(calls)")])
