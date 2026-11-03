import sqlite3
from collections import Counter

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
print("td_events cols", [r[1] for r in day.execute("PRAGMA table_info(td_events)")])
print("count", day.execute("SELECT count(*) FROM td_events").fetchone()[0])
print("types", day.execute("SELECT msg_type, count(*) FROM td_events GROUP BY msg_type ORDER BY 2 DESC").fetchall())
print("areas", day.execute("SELECT count(DISTINCT area_id) FROM td_events").fetchone()[0])
print("headcodes", day.execute("SELECT count(DISTINCT headcode) FROM td_events").fetchone()[0])
mapped = day.execute("SELECT count(*) FROM td_events WHERE tiploc IS NOT NULL AND trim(tiploc)!=''").fetchone()[0]
print("with tiploc", mapped)
print("with stanox", day.execute("SELECT count(*) FROM td_events WHERE stanox IS NOT NULL AND trim(stanox)!=''").fetchone()[0])
print("span", day.execute("SELECT min(received_at), max(received_at) FROM td_events").fetchone())
print("smart cols", [r[1] for r in cat.execute("PRAGMA table_info(smart_steps)")])
print("smart rows", cat.execute("SELECT count(*) FROM smart_steps").fetchone()[0])
# sample one known train
rows = day.execute("""
SELECT area_id, from_berth, berth, msg_type, ifnull(tiploc,''), ifnull(stanox,'')
FROM td_events WHERE headcode='2J68' ORDER BY received_at LIMIT 12
""").fetchall()
print("sample 2J68", len(rows))
for row in rows:
    print(" | ".join(row))
print("2J68 total", day.execute("SELECT count(*) FROM td_events WHERE headcode='2J68'").fetchone()[0])
print("2J68 mapped", day.execute("SELECT count(*) FROM td_events WHERE headcode='2J68' AND tiploc IS NOT NULL AND trim(tiploc)!=''").fetchone()[0])
# how many berth steps per headcode
counts = [r[0] for r in day.execute("SELECT count(*) c FROM td_events GROUP BY headcode")]
counts.sort()
if counts:
    print("steps per headcode median", counts[len(counts)//2], "p90", counts[int(len(counts)*0.9)], "max", counts[-1])
# share of events whose berth looks like a signal (letter+digits) vs location
print("distinct berths", day.execute("SELECT count(DISTINCT area_id||':'||berth) FROM td_events").fetchone()[0])
