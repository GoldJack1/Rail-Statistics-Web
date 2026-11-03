import json
import math
import re
import sqlite3
from collections import defaultdict, deque

bplan = sqlite3.connect("/home/darwin/rail-core/data/bplan-route.sqlite")
graph = defaultdict(set)
for left, right in bplan.execute("SELECT a, b FROM links"):
    left = left.upper()
    right = right.upper()
    if left != right:
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
        if not here or not other:
            continue
        if other == here or other in here or here in other:
            if best is None or distance < best[0]:
                best = (distance, code)
    return best[1] if best else ""


def shortest(start, end, cap=12):
    if start not in graph or end not in graph or start == end:
        return []
    queue = deque([(start, [start])])
    best = None
    found = []
    while queue:
        current, path = queue.popleft()
        if best is not None and len(path) > best:
            break
        if len(path) > cap:
            continue
        for nxt in graph[current]:
            if nxt in path:
                continue
            nxt_path = path + [nxt]
            if nxt == end:
                best = len(nxt_path)
                found.append(nxt_path)
                if len(found) > 8:
                    return found
            elif best is None or len(nxt_path) < best:
                queue.append((nxt, nxt_path))
    return found


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
        if index + 1 >= len(spine):
            break
        found = shortest(tiploc, spine[index + 1])
        if not found:
            continue
        length = len(found[0])
        chosen = [path for path in found if len(path) == length]
        if len(chosen) == 1:
            mids = chosen[0][1:-1]
        else:
            shared = set(chosen[0][1:-1])
            for path in chosen[1:]:
                shared &= set(path[1:-1])
            mids = [tiploc for tiploc in chosen[0][1:-1] if tiploc in shared]
        for mid in mids:
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
    same_order = [code for code in want if code in set(seen)] == [code for code in seen if code in set(want)]
    ok = not missing and not extra and same_order
    matched += bool(ok)
    miss_n += len(missing)
    extra_n += len(extra)
    if not ok:
        print(uid, "miss", " ".join(missing) or "-", "| extra", " ".join(extra) or "-")
print("MATCHED", matched, "missing", miss_n, "extra", extra_n)
