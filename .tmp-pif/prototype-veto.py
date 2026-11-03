import json
import math
import sqlite3
from collections import defaultdict

rtt = json.load(open("/tmp/rtt-stations.json"))
ours = json.load(open("/tmp/ours.json"))
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

seqs = []
at = defaultdict(list)
for (rid,) in day.execute("SELECT rid FROM services WHERE service_type='passenger' AND cancelled=0"):
    seq = []
    for (tpl,) in day.execute("SELECT tiploc FROM calls WHERE rid=? AND cancelled=0 ORDER BY seq", (rid,)):
        tpl = (tpl or "").upper()
        if tpl and (not seq or seq[-1] != tpl):
            seq.append(tpl)
    if len(seq) < 2:
        continue
    si = len(seqs)
    seqs.append(seq)
    for i, tpl in enumerate(seq):
        at[tpl].append((si, i))


def chain_away(chain, point):
    best = 1e18
    for i, place in enumerate(chain):
        best = min(best, math.hypot(place[0] - point[0], place[1] - point[1]))
        if i == 0:
            continue
        prev = chain[i - 1]
        dx, dy = place[0] - prev[0], place[1] - prev[1]
        length2 = dx * dx + dy * dy
        if length2 < 1:
            continue
        t = max(0.0, min(1.0, ((point[0] - prev[0]) * dx + (point[1] - prev[1]) * dy) / length2))
        best = min(best, math.hypot(point[0] - (prev[0] + t * dx), point[1] - (prev[1] + t * dy)))
    return best


def fill(spine):
    present = set(spine)
    added = [[] for _ in spine]
    for left in range(len(spine) - 1):
        a, b = spine[left], spine[left + 1]
        patterns = defaultdict(int)
        for si, i in at.get(a, ()):
            seq = seqs[si]
            end = -1
            for j in range(i + 1, min(len(seq), i + 13)):
                if seq[j] == b:
                    end = j
                    break
            if end < 0:
                continue
            stations = [t for t in seq[i + 1:end] if t in crs and t not in present]
            patterns[">".join(stations)] += 1
        established = [key for key, count in patterns.items() if count >= 3]
        if not established:
            continue
        required = None
        for key in established:
            got = set(key.split(">")) if key else set()
            required = got if required is None else required & got
        chain = [geo[t] for t in (a, b) if t in geo]
        if len(chain) < 2:
            continue
        kept = []
        for tpl in required or ():
            if not tpl or tpl not in geo:
                continue
            if chain_away(chain, geo[tpl]) > 8000:
                continue
            kept.append(tpl)
            present.add(tpl)
        added[left] = kept
    out = []
    for i, tpl in enumerate(spine):
        out.append(tpl)
        out.extend(added[i])
    return out


def codes(tiplocs):
    seen = []
    for tpl in tiplocs:
        code = crs.get(tpl)
        if not code:
            continue
        if not seen or seen[-1] != code:
            seen.append(code)
    return seen


matched = miss_n = extra_n = 0
print("== real anchors, direct timing vetoes")
for uid, want in rtt.items():
    stops = (ours.get(uid) or {}).get("stops") or []
    spine = []
    for stop in stops:
        if stop.get("src") == "inferred":
            continue
        tpl = (stop.get("tpl") or "").upper()
        if tpl and (not spine or spine[-1] != tpl):
            spine.append(tpl)
    seen = codes(fill(spine))
    missing = [c for c in want if c not in set(seen)]
    extra = [c for c in seen if c not in set(want)]
    rshared = [c for c in want if c in set(seen)]
    oshared = [c for c in seen if c in set(want)]
    if not missing and not extra and rshared == oshared:
        matched += 1
        print(f"OK  {uid}")
        continue
    miss_n += len(missing)
    extra_n += len(extra)
    print(f"GAP {uid} miss {' '.join(missing) or '-'} | extra {' '.join(extra) or '-'}")
print(f"MATCHED {matched}/{len(rtt)} missing {miss_n} extra {extra_n}")
