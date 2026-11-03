import json
import math
import sqlite3
from collections import defaultdict

rtt = {}
ends = {}
meta = """
W45560 BDM BTN
G38914 HHD CDF
C10015 GLM LUT
W33928 EUS HHD
C01934 NCL KGX
C21606 CLE MAT
W00035 BEV KGX
L89250 WGW LDS
C18510 SEV WGC
V21634 BTH PMH
C93331 KLN KGX
Y62439 FGH CDF
P76258 ELY LST
V21599 BPW PAD
C37254 ABW RDG
L80633 RDZ WAT
P28732 GTA NCL
W83290 AND MTH
L84462 WOK PMH
L81793 GLD WAT
W69654 LEV EDB
G14920 FRO PAD
W75871 BMV LIF
L83870 HSL WAT
G86151 ELP LIV
C14935 LNK GLC
C15594 SHS EDB
Y65422 NXG CYP
P69319 LMS WOF
Y64254 TPB FST
Y64364 PSE FST
C57142 HYK WKI
C18615 LET KGX
P89741 DMK GRV
Y64393 TIL FST
C00362 PBN SPX
W84932 OXN MIA
C18022 NMP CRE
C15112 EKL GLC
G39552 WXC BID
C30050 AVP MYB
W83880 WDL GLC
P24710 BPS PRE
J16470 WAD HGS
P24572 SCU SHF
Y81027 BLY EUS
P01918 FLX IPS
L37581 HWY MYB
W11371 NUN LMS
G61843 CHI LST
""".strip().splitlines()
for line in meta:
    uid, origin, dest = line.split()
    ends[uid] = (origin, dest)
for line in open("/tmp/rtt50.txt"):
    parts = line.split()
    rtt[parts[0]] = parts[1:]

ours = json.load(open("/tmp/ours50.json"))
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


def stop_codes(stops):
    seen = []
    for stop in stops:
        code = (stop.get("crs") or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            continue
        if not seen or seen[-1] != code:
            seen.append(code)
    return seen


def window(locs, origin, dest):
    if origin not in locs:
        return locs
    start = locs.index(origin)
    try:
        finish = locs.index(dest, start)
    except ValueError:
        return locs[start:]
    return locs[start:finish + 1]


def score(seen, want):
    missing = [c for c in want if c not in set(seen)]
    extra = [c for c in seen if c not in set(want)]
    same = not missing and not extra and [c for c in want if c in set(seen)] == [c for c in seen if c in set(want)]
    return same, missing, extra

cur_m = cur_miss = cur_extra = 0
new_m = new_miss = new_extra = 0
lost = gained = 0
print("uid origin-dest | new missing | new extra")
for uid, want_full in rtt.items():
    origin, dest = ends[uid]
    want = window(want_full, origin, dest)
    stops = (ours.get(uid) or {}).get("stops") or []
    spine = []
    for stop in stops:
        if stop.get("src") == "inferred":
            continue
        tpl = (stop.get("tpl") or "").upper()
        if tpl and (not spine or spine[-1] != tpl):
            spine.append(tpl)
    current = window(stop_codes(stops), origin, dest)
    fresh = window(codes(fill(spine)), origin, dest)
    ok_c, miss_c, extra_c = score(current, want)
    ok_n, miss_n, extra_n = score(fresh, want)
    cur_m += ok_c
    new_m += ok_n
    cur_miss += len(miss_c)
    cur_extra += len(extra_c)
    new_miss += len(miss_n)
    new_extra += len(extra_n)
    lost += len(set(current) & set(want) - set(fresh))
    gained += len(set(fresh) & set(want) - set(current))
    flag = "OK " if ok_n else ("ORD" if not miss_n and not extra_n else "GAP")
    print("%s %s %s-%s miss %s | extra %s" % (
        flag, uid, origin, dest,
        " ".join(miss_n) or "-",
        " ".join(extra_n) or "-",
    ))
print("CURRENT matched %d/50 missing %d extra %d" % (cur_m, cur_miss, cur_extra))
print("NEW matched %d/50 missing %d extra %d" % (new_m, new_miss, new_extra))
print("stations RTT and the current list share that the new rule drops %d" % lost)
print("stations RTT and the new rule share that the current list lacks %d" % gained)
