import sqlite3

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
names = {t.upper(): (n or "", c or "") for t, n, c in cat.execute("SELECT tiploc, name, crs FROM corpus")}

def trace(headcode):
    print("==", headcode)
    rows = day.execute("""
      SELECT received_at, msg_type, ifnull(area_id,''), ifnull(from_berth,''), ifnull(berth,''), ifnull(tiploc,'')
      FROM td_events WHERE headcode=? AND msg_type IN ('CA','CC')
      ORDER BY received_at
    """, (headcode,)).fetchall()
    last = None
    named = 0
    anon = 0
    shown = []
    for at, msg, area, frm, berth, tiploc in rows:
        tiploc = tiploc.upper()
        if not tiploc or tiploc == last:
            if not tiploc:
                anon += 1
            continue
        name, crs = names.get(tiploc, ("", ""))
        if not name.strip():
            anon += 1
            continue
        last = tiploc
        named += 1
        shown.append((tiploc, crs, name))
    print("named", named, "skipped", anon, "raw", len(rows))
    for row in shown:
        print(" ", " | ".join(row))

for hc in ("2J68", "1L73"):
    trace(hc)
