import heapq
import json
import sqlite3
from collections import defaultdict

rtt = json.load(open("/tmp/rtt-stations.json"))
ours = json.load(open("/tmp/ours.json"))
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")

crs_of = {}
for tpl, code in cat.execute("SELECT tiploc, crs FROM corpus WHERE crs IS NOT NULL AND trim(crs) != ''"):
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        crs_of[tpl.upper()] = code
geo = {}
for tpl, e, n in cat.execute("SELECT tiploc, easting, northing FROM tiploc_geo WHERE easting IS NOT NULL"):
    geo[tpl.upper()] = (float(e), float(n))

adj = defaultdict(dict)
for a, b, m, line in cat.execute("SELECT from_tpl, to_tpl, metres, running_line FROM nwk_edges"):
    if (line or "").upper() == "BUS":
        continue
    a, b = a.upper(), b.upper()
    if a == b:
        continue
    w = float(m) if m and m > 0 else 1000.0
    for x, y in ((a, b), (b, a)):
        prev = adj[x].get(y)
        if prev is None or w < prev:
            adj[x][y] = w

HOP = 30


def dijkstra(start, goal):
    if start == goal:
        return [start]
    pq = [(0.0, 0, start)]
    best = {start: (0.0, 0)}
    prev = {}
    while pq:
        dist, hops, node = heapq.heappop(pq)
        if best.get(node) != (dist, hops):
            continue
        if node == goal:
            break
        if hops >= HOP:
            continue
        for nxt, w in adj[node].items():
            nd, nh = dist + w, hops + 1
            old = best.get(nxt)
            if old is None or nd < old[0] - 0.5 or (abs(nd - old[0]) <= 0.5 and nh < old[1]):
                best[nxt] = (nd, nh)
                prev[nxt] = node
                heapq.heappush(pq, (nd, nh, nxt))
    if goal not in prev:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
        if len(path) > HOP + 2:
            return None
    path.reverse()
    return path


def station_codes(stops):
    seen = []
    for stop in stops:
        code = (stop.get("crs") or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            continue
        if not seen or seen[-1] != code:
            seen.append(code)
    return seen


def score(label, built):
    matched = miss_n = extra_n = 0
    print(f"\n== {label}")
    for uid, want in rtt.items():
        seen = built[uid]
        missing = [c for c in want if c not in set(seen)]
        extra = [c for c in seen if c not in set(want)]
        rshared = [c for c in want if c in set(seen)]
        oshared = [c for c in seen if c in set(want)]
        order_ok = rshared == oshared
        if not missing and not extra and order_ok:
            matched += 1
            continue
        miss_n += len(missing)
        extra_n += len(extra)
        print(f"GAP {uid} miss {len(missing)} extra {len(extra)} order {not order_ok}")
        if extra:
            print("  extra", " ".join(extra))
        if missing:
            print("  miss", " ".join(missing))
    print(f"MATCHED {matched}/{len(rtt)} missing {miss_n} extra {extra_n}")


cache = {}


def path_between(a, b):
    key = (a, b)
    if key not in cache:
        cache[key] = dijkstra(a, b)
    return cache[key]


baseline = {}
filtered = {}
dropped = []
kept = []
for uid, payload in ours.items():
    stops = payload.get("stops") or []
    baseline[uid] = station_codes(stops)
    spine_idx = [i for i, stop in enumerate(stops) if stop.get("src") != "inferred"]
    keep_flags = [True] * len(stops)
    for i, stop in enumerate(stops):
        if stop.get("src") != "inferred":
            continue
        code = (stop.get("crs") or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            continue
        prev_i = max((j for j in spine_idx if j < i), default=None)
        next_i = min((j for j in spine_idx if j > i), default=None)
        if prev_i is None or next_i is None:
            keep_flags[i] = False
            dropped.append((uid, stop.get("tpl"), code, "no-neighbour"))
            continue
        path = path_between(stops[prev_i]["tpl"].upper(), stops[next_i]["tpl"].upper())
        tpl = (stop.get("tpl") or "").upper()
        on = bool(path and tpl in path)
        keep_flags[i] = on
        (kept if on else dropped).append((uid, tpl, code))
    filtered[uid] = station_codes([stop for stop, flag in zip(stops, keep_flags) if flag])

score("current API", baseline)
score("drop inferred stations off the shortest network path", filtered)
print("\nDROPPED")
for row in dropped:
    print(" ", " ".join(row))
print("\nKEPT inferred on path")
for row in kept:
    print(" ", " ".join(row))
