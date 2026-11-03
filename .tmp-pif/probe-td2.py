import sqlite3

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")

def show(label, rows):
    print(label)
    for row in rows:
        print(" ", row)

show("2J68 first steps", day.execute("""
SELECT ifnull(area_id,''), ifnull(from_berth,''), ifnull(berth,''), msg_type, ifnull(tiploc,''), ifnull(stanox,'')
FROM td_events WHERE headcode='2J68' ORDER BY received_at LIMIT 15
""").fetchall())
print("2J68 steps", day.execute("SELECT count(*) FROM td_events WHERE headcode='2J68'").fetchone()[0])
print("2J68 mapped", day.execute("SELECT count(*) FROM td_events WHERE headcode='2J68' AND ifnull(tiploc,'')!=''").fetchone()[0])
print("2J68 distinct tiplocs", day.execute("SELECT count(DISTINCT tiploc) FROM td_events WHERE headcode='2J68' AND ifnull(tiploc,'')!=''").fetchone()[0])

# berth shape: 4 chars, starts with letter often a signal
rows = day.execute("SELECT berth FROM td_events WHERE msg_type='CA' AND berth IS NOT NULL LIMIT 200000").fetchall()
letter = digit = other = 0
for (berth,) in rows:
    b = berth.strip().upper()
    if len(b) == 4 and b[0].isalpha() and b[1:].isdigit():
        letter += 1
    elif b.isdigit():
        digit += 1
    else:
        other += 1
print("berth sample", len(rows), "letter+digits", letter, "all digits", digit, "other", other)

print("smart line filled", cat.execute("SELECT count(*) FROM smart_steps WHERE ifnull(from_line,'')!='' OR ifnull(to_line,'')!=''").fetchone()[0])
print("smart platform filled", cat.execute("SELECT count(*) FROM smart_steps WHERE ifnull(platform,'')!=''").fetchone()[0])
print("smart event types", cat.execute("SELECT event_type, count(*) FROM smart_steps GROUP BY event_type ORDER BY 2 DESC LIMIT 12").fetchall())

# G89428 headcode from earlier was 1L73? check a couple of the 50
for hc in ("1L73", "9T03", "1D89"):
    n, m = day.execute("""
      SELECT count(*), sum(CASE WHEN ifnull(tiploc,'')!='' THEN 1 ELSE 0 END)
      FROM td_events WHERE headcode=?
    """, (hc,)).fetchone()
    print(hc, "steps", n, "mapped", m)
