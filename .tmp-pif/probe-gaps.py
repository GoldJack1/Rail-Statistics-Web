import sqlite3

day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
rid = day.execute("SELECT rid FROM services WHERE uid='W33928'").fetchone()[0]
print("rid", rid)
want = {"CHDNGTN", "TRING", "LEDBRNJ", "LTNBZRD", "VALLEY", "HLYH", "BODORGN", "TYCROES", "RHOSNGR", "QPRK", "QPRKAC"}
want_crs = {"CED", "BOR", "TYC", "RHO", "QPW", "TRI", "LBZ", "HHD", "VAL"}
for tiploc, code in day.execute("SELECT tiploc, crs FROM calls WHERE rid=? ORDER BY seq", (rid,)):
    code = (code or "").strip().upper()
    tiploc = (tiploc or "").upper()
    if tiploc in want or code in want_crs:
        print(tiploc, code)

bplan = sqlite3.connect("/home/darwin/rail-core/data/bplan-route.sqlite")
print("tring-ledburn", bplan.execute(
    "SELECT a, b FROM links WHERE (a='TRING' AND b='LEDBRNJ') OR (a='LEDBRNJ' AND b='TRING')"
).fetchall())
print("cheddington", bplan.execute(
    "SELECT a, b FROM links WHERE a='CHDNGTN' OR b='CHDNGTN'"
).fetchall())
print("goring-tilehurst", bplan.execute(
    "SELECT a, b FROM links WHERE (a='GORASTR' AND b='TILHRST') OR (a='TILHRST' AND b='GORASTR')"
).fetchall())
print("pangbourne", bplan.execute(
    "SELECT a, b FROM links WHERE a='PANGBRN' OR b='PANGBRN'"
).fetchall())
print("valley-holyhead", bplan.execute(
    "SELECT a, b FROM links WHERE (a='VALLEY' AND b='HLYH') OR (a='HLYH' AND b='VALLEY')"
).fetchall())
print("anglesey", bplan.execute(
    "SELECT a, b FROM links WHERE a IN ('BODORGN','TYCROES','RHOSNGR','VALLEY','HLYH') OR b IN ('BODORGN','TYCROES','RHOSNGR')"
).fetchall()[:30])
