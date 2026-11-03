import json
import urllib.request

key = None
for line in open("/home/darwin/rail-core-dev/.env"):
    if line.startswith("INTERNAL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")
req = urllib.request.Request(
    "http://127.0.0.1:4002/api/service/G89428/2026-10-26",
    headers={"x-internal-key": key},
)
with urllib.request.urlopen(req, timeout=60) as res:
    body = json.loads(res.read().decode())
for stop in body.get("stops") or []:
    print((stop.get("actualSource") or ""), (stop.get("crs") or ""), stop.get("name") or stop.get("tpl"))
