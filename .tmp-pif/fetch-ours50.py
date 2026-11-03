import json
import urllib.request

key = None
for line in open("/home/darwin/rail-core-dev/.env"):
    if line.startswith("INTERNAL_API_KEY="):
        key = line.split("=", 1)[1].strip().strip('"').strip("'")
uids = "W45560,G38914,C10015,W33928,C01934,C21606,W00035,L89250,C18510,V21634,C93331,Y62439,P76258,V21599,C37254,L80633,P28732,W83290,L84462,L81793,W69654,G14920,W75871,L83870,G86151,C14935,C15594,Y65422,P69319,Y64254,Y64364,C57142,C18615,P89741,Y64393,C00362,W84932,C18022,C15112,G39552,C30050,W83880,P24710,J16470,P24572,Y81027,P01918,L37581,W11371,G61843".split(",")
out = {}
for uid in uids:
    req = urllib.request.Request(
        "http://127.0.0.1:4002/api/service/%s/2026-10-26" % uid,
        headers={"x-internal-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            body = json.loads(res.read().decode())
    except Exception as exc:
        out[uid] = {"error": type(exc).__name__, "stops": []}
        print(uid, "ERR", type(exc).__name__)
        continue
    stops = []
    for stop in body.get("stops") or []:
        stops.append({
            "tpl": stop.get("tpl") or stop.get("tiploc") or "",
            "crs": stop.get("crs") or "",
            "src": stop.get("actualSource") or stop.get("src") or "",
            "name": stop.get("name") or "",
        })
    out[uid] = {"stops": stops}
    print(uid, len(stops))
json.dump(out, open("/tmp/ours50.json", "w"))
print("WROTE", len(out))
