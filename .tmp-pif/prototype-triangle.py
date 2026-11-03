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


def public(tiploc):
    own = crs.get(tiploc, "")
    if tiploc not in geo:
        return own
    here = norm(name.get(tiploc))
    best = None
    for station, point, code, label in station_points:
        distance = math.hypot(geo[tiploc][0] - point[0], geo[tiploc][1] - point[1])
        if distance > 200:
            continue
        other = norm(label)
        if not here or not other or not (other == here or other in here or here in other):
            continue
        plain = 0 if any(word in (label or "").lower() for word in ("crossrail", "low level", "high level", " ll", " hl")) else 1
        rank = (plain, -len(station), -distance)
        if best is None or rank > best[0]:
            best = (rank, code)
    return best[1] if best else own


def offset(start, end, tiploc):
    if start not in geo or end not in geo or tiploc not in geo:
        return None
    a, b, p = geo[start], geo[end], geo[tiploc]
    east, north = b[0] - a[0], b[1] - a[1]
    length2 = east * east + north * north
    if length2 < 1:
        return 0
    t = ((p[0] - a[0]) * east + (p[1] - a[1]) * north) / length2
    if t <= 0.02 or t >= 0.98:
        return None
    return math.hypot(p[0] - (a[0] + t * east), p[1] - (a[1] + t * north))


def expand(start, end, slack, depth=0):
    if depth > 6 or start not in graph or end not in graph:
        return []
    mids = []
    for tiploc in graph[start]:
        if tiploc == end or end not in graph[tiploc]:
            continue
        away = offset(start, end, tiploc)
        if away is not None and away <= slack:
            mids.append(tiploc)
    if not mids:
        return []
    mids.sort(key=lambda tiploc: offset(start, end, tiploc))
    # One location on the chord. A second location this close is the other line.
    chosen = mids[0]
    if len(mids) > 1 and offset(start, end, mids[1]) < slack and abs(offset(start, end, mids[0]) - offset(start, end, mids[1])) < 150:
        return []
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


for pair in (("GORASTR", "TILHRST", "PANGBRN"), ("HATFILD", "WELWYN", "WELHAMG"), ("VALLEY", "HLYH", "RHOSNGR"), ("TRING", "LEDBRNJ", "CHDNGTN"), ("METHLYJ", "ALTFTJN", "CASTLFD")):
    print(pair, "offset", offset(pair[0], pair[1], pair[2]), "common", pair[2] in graph[pair[0]] and pair[1] in graph[pair[2]])

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

for slack in (800, 2500, 6000):
    matched = miss_n = extra_n = 0
    lines = []
    for uid, full in rtt.items():
        origin, dest = ends[uid]
        want = window(full, origin, dest)
        stops = (ours.get(uid) or {}).get("stops") or []
        spine = []
        for stop in stops:
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
            code = public(tiploc)
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
        if not ok and slack == 2500:
            lines.append("%s miss %s | extra %s" % (uid, " ".join(missing) or "-", " ".join(extra) or "-"))
    print("SLACK", slack, "MATCHED", matched, "missing", miss_n, "extra", extra_n)
    if slack == 2500:
        print("\n".join(lines))
