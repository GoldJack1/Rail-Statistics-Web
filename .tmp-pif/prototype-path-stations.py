import heapq
import json
import sqlite3
from collections import defaultdict

rtt = json.load(open("/tmp/rtt-stations.json"))
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")

crs = {}
for tpl, code in cat.execute("SELECT tiploc, crs FROM corpus WHERE crs IS NOT NULL AND trim(crs) != ''"):
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        crs[tpl.upper()] = code
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
    w = float(m) if m and m > 0 else None
    if w is None:
        pa, pb = geo.get(a), geo.get(b)
        w = ((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2) ** 0.5 if pa and pb else 1000.0
    for x, y in ((a, b), (b, a)):
        prev = adj[x].get(y)
        if prev is None or w < prev:
            adj[x][y] = w

HOP = 30
SNAP = 400


def dijkstra(start, goal, banned=None):
    if start == goal:
        return [start], 0.0
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
            edge = (node, nxt) if node < nxt else (nxt, node)
            if banned and edge in banned:
                continue
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
    return path, best[goal][0]


def dist_to_seg(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    if length2 < 1:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return ((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2) ** 0.5


matched = miss_n = extra_n = 0
for uid, want in rtt.items():
    rid = day.execute("SELECT rid FROM services WHERE uid=?", (uid,)).fetchone()
    if not rid:
        print(uid, "NO SERVICE")
        continue
    spine = [r[0].upper() for r in day.execute(
        "SELECT tiploc FROM calls WHERE rid=? AND cancelled=0 ORDER BY seq", (rid[0],)
    )]
    compact = []
    for tpl in spine:
        if not compact or compact[-1] != tpl:
            compact.append(tpl)
    present = set(compact)
    splices = [[] for _ in compact]
    ambiguous_gaps = no_path = 0
    for i in range(len(compact) - 1):
        a, b = compact[i], compact[i + 1]
        found = dijkstra(a, b)
        if not found:
            no_path += 1
            continue
        path, dist = found
        banned = {(u, v) if u < v else (v, u) for u, v in zip(path, path[1:])}
        alt = dijkstra(a, b, banned)
        close = False
        alt_path = None
        if alt:
            alt_path, alt_dist = alt
            close = alt_dist <= max(dist * 1.10, dist + 2000)

        def stations_on(p):
            return [tpl for tpl in p[1:-1] if tpl in crs and tpl not in present]

        if close:
            ambiguous_gaps += 1
        chosen = stations_on(path)
        use_snap = False
        order = {tpl: idx for idx, tpl in enumerate(path)}
        if use_snap:
            for u, v in zip(path, path[1:]):
                pu, pv = geo.get(u), geo.get(v)
                if not pu or not pv:
                    continue
                for mid in adj[u]:
                    if mid in order or mid in present or mid not in crs:
                        continue
                    if v not in adj[mid]:
                        continue
                    pm = geo.get(mid)
                    if pm and dist_to_seg(pm, pu, pv) <= SNAP:
                        chosen.append(mid)
                        order[mid] = order[u] + 0.5
        chosen = list(dict.fromkeys(chosen))
        chosen.sort(key=lambda tpl: order.get(tpl, 999))
        splices[i] = chosen
        for tpl in chosen:
            present.add(tpl)
    seq = []
    for i, tpl in enumerate(compact):
        if tpl in crs:
            seq.append(crs[tpl])
        for mid in splices[i]:
            seq.append(crs[mid])
    seen = []
    for code in seq:
        if not seen or seen[-1] != code:
            seen.append(code)
    missing = [c for c in want if c not in set(seen)]
    extra = [c for c in seen if c not in set(want)]
    rshared = [c for c in want if c in set(seen)]
    oshared = [c for c in seen if c in set(want)]
    order_ok = rshared == oshared
    if not missing and not extra and order_ok:
        matched += 1
        print(f"OK  {uid} stations {len(seen)} ambig {ambiguous_gaps} nopath {no_path}")
    else:
        miss_n += len(missing)
        extra_n += len(extra)
        print(f"GAP {uid} rtt {len(want)} ours {len(seen)} ambig {ambiguous_gaps} nopath {no_path}")
        if missing:
            print("  miss", " ".join(missing))
        if extra:
            print("  extra", " ".join(extra))
        if not order_ok:
            for j, (x, y) in enumerate(zip(rshared, oshared)):
                if x != y:
                    print("  order", " ".join(rshared[j:j + 6]), "||", " ".join(oshared[j:j + 6]))
                    break
            else:
                print(f"  shared length {len(rshared)} vs {len(oshared)}")
print(f"MATCHED {matched}/{len(rtt)} missing {miss_n} extra {extra_n}")
