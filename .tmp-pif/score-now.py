import json
import re
import urllib.request

key = None
for line in open("/home/darwin/rail-core-dev/.env"):
    if line.startswith("INTERNAL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")

rtt = {}
for line in open("/tmp/rtt50.txt"):
    parts = line.split()
    rtt[parts[0]] = parts[1:]
meta = re.search(r'meta = """(.*?)"""', open("/tmp/compare50.py").read(), re.S).group(1)
ends = {}
for line in meta.strip().splitlines():
    uid, origin, dest = line.split()
    ends[uid] = (origin, dest)

def window(locs, origin, dest):
    if origin not in locs:
        return locs
    start = locs.index(origin)
    try:
        finish = locs.index(dest, start)
    except ValueError:
        return locs[start:]
    return locs[start:finish + 1]

matched = miss_n = extra_n = 0
for uid, full in rtt.items():
    origin, dest = ends[uid]
    want = window(full, origin, dest)
    req = urllib.request.Request(
        "http://127.0.0.1:4002/api/service/%s/2026-10-26" % uid,
        headers={"x-internal-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            body = json.loads(res.read().decode())
    except Exception as exc:
        print("ERR", uid, type(exc).__name__)
        continue
    seen = []
    for stop in body.get("stops") or []:
        code = (stop.get("crs") or "").strip().upper()
        if len(code) != 3 or code.startswith("X"):
            continue
        if not seen or seen[-1] != code:
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
print("MATCHED %d/50 missing %d extra %d" % (matched, miss_n, extra_n))
