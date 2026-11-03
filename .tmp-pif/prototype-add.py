import json
import math
import re
import sqlite3
from collections import defaultdict

bplan = sqlite3.connect("/home/darwin/rail-core/data/bplan-route.sqlite")
graph = defaultdict(set)
for left, right in bplan.execute("SELECT a, b FROM links"):
    left = (left or "").upper()
    right = (right or "").upper()
    if left and right and left != right:
        graph[left].add(right)
        graph[right].add(left)

catalog = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
crs = {}
name = {}
geo = {}
for tiploc, code, label in catalog.execute("SELECT tiploc, crs, name FROM corpus"):
    tiploc = (tiploc or "").upper()
    name[tiploc] = label or ""
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        crs[tiploc] = code
for tiploc, east, north in catalog.execute(
    "SELECT tiploc, easting, northing FROM tiploc_geo WHERE easting IS NOT NULL"
):
    geo[tiploc.upper()] = (float(east), float(north))
station_points = [(tiploc, geo[tiploc], crs[tiploc], name[tiploc]) for tiploc in crs if tiploc in geo]


def norm(value):
    text = (value or "").lower().replace("'", "")
    for word in ("(ac)", "(dc)", "(crossrail)", "crossrail", "low level", "high level"):
        text = text.replace(word, " ")
    return " ".join(text.split())


def blank_alias(tiploc):
    if tiploc in crs or tiploc not in geo:
        return crs.get(tiploc, "")
    here = norm(name.get(tiploc))
    best = None
    for station, point, code, label in station_points:
        distance = math.hypot(geo[tiploc][0] - point[0], geo[tiploc][1] - point[1])
        if distance > 80 or not here:
            continue
        other = norm(label)
        if other == here or (other and other in here):
            if best is None or distance < best[0]:
                best = (distance, code)
    return best[1] if best else ""


def offset(start, end, tiploc):
    if start not in geo or end not in geo or tiploc not in geo:
        return None
    a, b, p = geo[start], geo[end], geo[tiploc]
    east, north = b[0] - a[0], b[1] - a[1]
    length2 = east * east + north * north
    if length2 < 1:
        return None
    t = ((p[0] - a[0]) * east + (p[1] - a[1]) * north) / length2
    if t <= 0.02 or t >= 0.98:
        return None
    return math.hypot(p[0] - (a[0] + t * east), p[1] - (a[1] + t * north))


def expand(start, end, slack, depth=0):
    if depth > 8:
        return []
    found = []
    for tiploc in graph.get(start, ()):
        if tiploc == end or end not in graph.get(tiploc, ()):
            continue
        away = offset(start, end, tiploc)
        if away is not None and away <= slack:
            found.append((0 if tiploc in crs else 1, away, tiploc))
    if not found:
        return []
    found.sort()
    if len(found) > 1 and found[1][0] == found[0][0] and abs(found[0][1] - found[1][1]) < 200:
        return []
    chosen = found[0][2]
    return expand(start, chosen, slack, depth + 1) + [chosen] + expand(chosen, end, slack, depth + 1)


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

slack = 1600
matched = miss_n = extra_n = 0
for uid, full in rtt.items():
    origin, dest = ends[uid]
    want = window(full, origin, dest)
    stops = (ours.get(uid) or {}).get("stops") or []
    spine = []
    seen = []
    for stop in stops:
        tiploc = (stop.get("tpl") or "").upper()
        code = (stop.get("crs") or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            code = blank_alias(tiploc)
        if stop.get("src") != "inferred" and tiploc and (not spine or spine[-1] != tiploc):
            spine.append(tiploc)
        if code and (not seen or seen[-1] != code):
            seen.append(code)
    for index in range(len(spine) - 1):
        for mid in expand(spine[index], spine[index + 1], slack):
            code = crs.get(mid) or blank_alias(mid)
            if code and code not in seen:
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
