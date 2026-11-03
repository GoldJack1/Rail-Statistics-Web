import json
import math
import re
import sqlite3
from collections import defaultdict

catalog = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")
name = {}
geo = {}
points = []
for tiploc, code, label in catalog.execute("SELECT tiploc, crs, name FROM corpus"):
    tiploc = (tiploc or "").upper()
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        name[tiploc] = label or ""
        points.append(tiploc)
for tiploc, east, north in catalog.execute(
    "SELECT tiploc, easting, northing FROM tiploc_geo WHERE easting IS NOT NULL"
):
    geo[tiploc.upper()] = (float(east), float(north))
crs = {}
for tiploc, code, label in catalog.execute("SELECT tiploc, crs, name FROM corpus"):
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        crs[(tiploc or "").upper()] = code

def norm(value):
    text = (value or "").lower().replace("'", "")
    for word in ("(ac)", "(dc)", "(crossrail)", "crossrail", "low level", "high level"):
        text = text.replace(word, " ")
    return " ".join(text.split())

usage = defaultdict(int)
for (code,) in day.execute("SELECT crs FROM calls WHERE crs IS NOT NULL AND length(crs)=3"):
    usage[code.upper()] += 1

# tiploc -> public crs
public = {}
for tiploc in crs:
    if tiploc not in geo:
        public[tiploc] = crs[tiploc]
        continue
    group = [tiploc]
    here = norm(name.get(tiploc))
    for other in crs:
        if other == tiploc or other not in geo or not here:
            continue
        if norm(name.get(other)) != here:
            continue
        distance = math.hypot(geo[tiploc][0] - geo[other][0], geo[tiploc][1] - geo[other][1])
        if distance <= 200:
            group.append(other)
    best = max(group, key=lambda item: usage[crs[item]])
    public[tiploc] = crs[best]

def window(locs, origin, dest):
    if origin not in locs:
        return locs
    start = locs.index(origin)
    try:
        finish = locs.index(dest, start)
    except ValueError:
        return locs[start:]
    return locs[start : finish + 1]

rtt = {}
for line in open("/tmp/rtt50.txt"):
    parts = line.split()
    rtt[parts[0]] = parts[1:]
meta = re.search(r'meta = """(.*?)"""', open("/tmp/compare50.py").read(), re.S).group(1)
ends = {}
for line in meta.strip().splitlines():
    uid, origin, dest = line.split()
    ends[uid] = (origin, dest)
ours = json.load(open("/tmp/ours50.json"))
matched = miss_n = extra_n = 0
for uid, full in rtt.items():
    origin, dest = ends[uid]
    want = window(full, origin, dest)
    seen = []
    for stop in (ours.get(uid) or {}).get("stops") or []:
        tiploc = (stop.get("tpl") or "").upper()
        code = public.get(tiploc) or ""
        if not code:
            raw = (stop.get("crs") or "").strip().upper()
            if len(raw) == 3 and not raw.startswith("X"):
                code = raw
        if code and (not seen or seen[-1] != code):
            seen.append(code)
    seen = window(seen, origin, dest)
    missing = [code for code in want if code not in set(seen)]
    extra = [code for code in seen if code not in set(want)]
    ok = not missing and not extra
    matched += bool(ok)
    miss_n += len(missing)
    extra_n += len(extra)
    if not ok:
        print("%s miss %s | extra %s" % (uid, " ".join(missing) or "-", " ".join(extra) or "-"))
print("MATCHED", matched, "missing", miss_n, "extra", extra_n)
