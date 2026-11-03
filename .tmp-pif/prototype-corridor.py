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
located = [tiploc for tiploc in graph if tiploc in geo]
station_points = [(tiploc, geo[tiploc], crs[tiploc], name[tiploc]) for tiploc in crs if tiploc in geo]


def norm(value):
    text = (value or "").lower().replace("'", "")
    for word in ("(ac)", "(dc)", "(crossrail)", "crossrail", "low level", "high level"):
        text = text.replace(word, " ")
    return " ".join(text.split())


def alias(tiploc):
    if tiploc in crs or tiploc not in geo:
        return crs.get(tiploc, "")
    here = norm(name.get(tiploc))
    best = None
    for station, point, code, label in station_points:
        distance = math.hypot(geo[tiploc][0] - point[0], geo[tiploc][1] - point[1])
        if distance > 200:
            continue
        other = norm(label)
        if here and other and (other == here or other in here or here in other):
            if best is None or distance < best[0]:
                best = (distance, code)
    return best[1] if best else ""


def project(start, end, point):
    east = end[0] - start[0]
    north = end[1] - start[1]
    length2 = east * east + north * north
    if length2 < 1:
        return 0.0, math.hypot(point[0] - start[0], point[1] - start[1])
    t = ((point[0] - start[0]) * east + (point[1] - start[1]) * north) / length2
    nearest_e = start[0] + t * east
    nearest_n = start[1] + t * north
    return t, math.hypot(point[0] - nearest_e, point[1] - nearest_n)


def expand(start, end, slack):
    if start not in geo or end not in geo or start == end:
        return []
    a = geo[start]
    b = geo[end]
    nodes = {start, end}
    place = {start: (0.0, 0.0), end: (1.0, 0.0)}
    for tiploc in located:
        if tiploc in nodes:
            continue
        t, away = project(a, b, geo[tiploc])
        if 0.02 < t < 0.98 and away <= slack:
            nodes.add(tiploc)
            place[tiploc] = (t, away)
    best = None
    best_at = {start: (0, [start])}
    ordered = sorted(nodes, key=lambda tiploc: place[tiploc][0])
    for tiploc in ordered:
        if tiploc == start:
            continue
        choice = None
        for prev in graph[tiploc]:
            if prev not in best_at or place[prev][0] >= place[tiploc][0]:
                continue
            hops, path = best_at[prev]
            if choice is None or hops + 1 > choice[0]:
                choice = (hops + 1, path + [tiploc])
        if choice:
            best_at[tiploc] = choice
    path = best_at.get(end)
    return path[1][1:-1] if path else []


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

for slack in (400, 800, 1500):
    matched = miss_n = extra_n = 0
    lines = []
    for uid, full in rtt.items():
        origin, dest = ends[uid]
        want = window(full, origin, dest)
        spine = []
        for stop in (ours.get(uid) or {}).get("stops") or []:
            if stop.get("src") == "inferred":
                continue
            tiploc = (stop.get("tpl") or "").upper()
            if tiploc and (not spine or spine[-1] != tiploc):
                spine.append(tiploc)
        out = []
        for index, tiploc in enumerate(spine):
            out.append(tiploc)
            if index + 1 < len(spine):
                for mid in expand(tiploc, spine[index + 1], slack):
                    if mid not in out:
                        out.append(mid)
        seen = []
        for tiploc in out:
            code = crs.get(tiploc) or alias(tiploc)
            if code and (not seen or seen[-1] != code):
                seen.append(code)
        seen = window(seen, origin, dest)
        missing = [code for code in want if code not in set(seen)]
        extra = [code for code in seen if code not in set(want)]
        same = [code for code in want if code in set(seen)] == [code for code in seen if code in set(want)]
        ok = not missing and not extra and same
        matched += bool(ok)
        miss_n += len(missing)
        extra_n += len(extra)
        if not ok:
            lines.append("%s miss %s | extra %s" % (uid, " ".join(missing) or "-", " ".join(extra) or "-"))
    print("SLACK", slack, "MATCHED", matched, "missing", miss_n, "extra", extra_n)
    if slack == 800:
        print("\n".join(lines))
