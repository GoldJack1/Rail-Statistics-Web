import json
import sqlite3

rtt = json.load(open("/tmp/rtt-stations.json"))
ours = json.load(open("/tmp/ours.json"))
cat = sqlite3.connect("/home/darwin/rail-core/data/catalog.sqlite")
day = sqlite3.connect("/home/darwin/rail-core/data/day-2026-10-26.sqlite")

crs_of = {}
for tpl, code in cat.execute("SELECT tiploc, crs FROM corpus WHERE crs IS NOT NULL AND trim(crs) != ''"):
    code = (code or "").strip().upper()
    if len(code) == 3 and not code.startswith("X"):
        crs_of[tpl.upper()] = code

seqs = []
for (rid,) in day.execute("SELECT rid FROM services WHERE service_type='passenger' AND cancelled=0"):
    seq = [row[0].upper() for row in day.execute(
        "SELECT tiploc FROM calls WHERE rid=? AND cancelled=0 ORDER BY seq", (rid,)
    )]
    compact = []
    for tpl in seq:
        if tpl and (not compact or compact[-1] != tpl):
            compact.append(tpl)
    if len(compact) >= 2:
        seqs.append(compact)
print("sequences", len(seqs), flush=True)


def station_codes(stops):
    seen = []
    for stop in stops:
        code = (stop.get("crs") or crs_of.get((stop.get("tpl") or "").upper()) or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            continue
        if not seen or seen[-1] != code:
            seen.append(code)
    return seen


def is_inferred_station(stop):
    code = (stop.get("crs") or "").strip().upper()
    return stop.get("src") == "inferred" and len(code) == 3 and not code.startswith("X")


def fill(stops, use_overlap):
    spine = [stop for stop in stops if not is_inferred_station(stop)]
    present = {(stop.get("tpl") or "").upper() for stop in spine}
    inserted = [[] for _ in spine]
    for left in range(len(spine) - 1):
        right = left + 1
        a = (spine[left].get("tpl") or "").upper()
        b = (spine[right].get("tpl") or "").upper()
        booked = set()
        paths = []
        for seq in seqs:
            try:
                start = seq.index(a)
            except ValueError:
                continue
            end = -1
            for index in range(start + 1, min(len(seq), start + 13)):
                if seq[index] == b:
                    end = index
                    break
            if end < 0:
                continue
            mids = seq[start + 1:end]
            overlap = sum(1 for tpl in mids if tpl in booked)
            paths.append((mids, overlap))
        if not paths:
            continue
        if use_overlap and booked:
            top = max(path[1] for path in paths)
            fitting = [path for path in paths if path[1] > 0 and path[1] == top]
        else:
            fitting = paths
        patterns = {}
        for mids, _overlap in fitting:
            stations = [tpl for tpl in mids if tpl in crs_of and tpl not in present and tpl not in booked]
            key = ">".join(stations)
            patterns[key] = patterns.get(key, 0) + 1
        established = [key for key, count in patterns.items() if count >= 3]
        if not established:
            continue
        required = None
        for key in established:
            stations = set(key.split(">")) if key else set()
            required = stations if required is None else required & stations
        for tpl in required or ():
            if not tpl or tpl in present:
                continue
            present.add(tpl)
            inserted[left].append({"tpl": tpl, "crs": crs_of[tpl], "src": "inferred"})
    out = []
    for index, stop in enumerate(spine):
        out.append(stop)
        out.extend(inserted[index])
    return out


def score(label, built):
    matched = miss_n = extra_n = 0
    print(f"\n== {label}")
    for uid, want in rtt.items():
        seen = station_codes(built[uid])
        missing = [c for c in want if c not in set(seen)]
        extra = [c for c in seen if c not in set(want)]
        rshared = [c for c in want if c in set(seen)]
        oshared = [c for c in seen if c in set(want)]
        if not missing and not extra and rshared == oshared:
            matched += 1
            continue
        miss_n += len(missing)
        extra_n += len(extra)
        print(f"GAP {uid} miss {' '.join(missing) or '-'} | extra {' '.join(extra) or '-'}")
    print(f"MATCHED {matched}/{len(rtt)} missing {miss_n} extra {extra_n}")


rebuilt = {}
plain = {}
for uid, payload in ours.items():
    stops = payload.get("stops") or []
    rebuilt[uid] = fill(stops, True)
    plain[uid] = fill(stops, False)

score("overlap filter kept", rebuilt)
score("every established pattern, no overlap filter", plain)
