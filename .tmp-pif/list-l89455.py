import json
import math
import urllib.request

key = None
for line in open("/home/darwin/rail-core-dev/.env"):
    if line.startswith("INTERNAL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")

def fetch(uid):
    req = urllib.request.Request(
        "http://127.0.0.1:4002/api/service/%s/2026-10-26" % uid,
        headers={"x-internal-key": key},
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        return json.loads(res.read().decode())

def hav(a, b):
    r = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(h)))

body = fetch("L89455")
print("L89455")
prev = None
for stop in body.get("stops") or []:
    name = stop.get("name") or stop.get("tpl")
    lat, lng = stop.get("lat"), stop.get("lng")
    gap = ""
    if prev and lat is not None and prev[0] is not None:
        gap = "  gap_m %d" % hav(prev, (lat, lng))
    prev = (lat, lng) if lat is not None else prev
    print("%s %s %s %s%s" % (stop.get("actualSource") or stop.get("src") or "-", stop.get("crs") or "", name, "" if lat is None else "%.5f,%.5f" % (lat, lng), gap))
