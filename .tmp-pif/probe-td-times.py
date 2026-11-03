import sqlite3
from datetime import datetime, timezone

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
print("services", day.execute(
    "SELECT rid, uid, origin_name, destination_name FROM services WHERE headcode='2J68'"
).fetchall())
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
names = {t.upper(): n for t, n in cat.execute("SELECT tiploc, name FROM corpus")}
rows = day.execute("""
  SELECT received_at, ifnull(tiploc,'') FROM td_events
  WHERE headcode='2J68' AND msg_type='CA' AND ifnull(tiploc,'')!=''
  ORDER BY received_at
""").fetchall()
last = None
for at, tiploc in rows:
    tiploc = tiploc.upper()
    if tiploc == last:
        continue
    last = tiploc
    clock = datetime.fromtimestamp(at/1000, timezone.utc).strftime("%H:%M:%S")
    if tiploc in ("NRCH","LEEDS","LOWSTFT","BDSTON","BRADIN","GRVPK","GLGQHL","CWLRSSJ"):
        print(clock, tiploc, names.get(tiploc, ""))
