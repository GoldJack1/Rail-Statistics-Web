import json
import urllib.request

key = None
for line in open("/home/darwin/rail-core-dev/.env"):
    if line.startswith("INTERNAL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")

def stops(uid):
    req = urllib.request.Request(
        "http://127.0.0.1:4002/api/service/%s/2026-10-26" % uid,
        headers={"x-internal-key": key},
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        body = json.loads(res.read().decode())
    out = []
    for stop in body.get("stops") or []:
        out.append((stop.get("name") or "", stop.get("crs") or "", stop.get("actualSource") or stop.get("src") or ""))
    return out

for uid in ("L89455", "G89428"):
    rows = stops(uid)
    names = [name for name, crs, src in rows]
    print("==", uid, len(rows))
    print("CASTLEFORD", any("Castleford" in name for name in names))
    print("NORWICH", any(name == "Norwich" for name in names))
    print("GLASGOW", any("Glasgow" in name for name in names))
    print("MILL", any("Mill Lane" in name for name in names))
    interesting = ("Cottingley", "Morley", "Woodlesford", "Normanton", "Chapeltown", "Wombwell", "Elsecar", "Halifax", "Bradford", "Altofts", "Methley", "Willesden", "Ninian", "Cardiff Queen")
    for name, crs, src in rows:
        if any(word in name for word in interesting):
            print(" ", src, crs, name)
