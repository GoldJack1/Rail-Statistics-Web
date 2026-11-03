import json
import os
import urllib.request

key = os.environ["INTERNAL_API_KEY"]

def get(port, path):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}" + path,
        headers={"x-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)

for port in (4001, 4002):
    for rid, label in (("202610306704570", "tonight"), ("202610296704568", "last night")):
        svc = get(port, "/api/service/" + rid)
        print(f"\nport {port} {label} ssd={svc.get('ssd')} dest={svc.get('destinationName')}")
        for s in svc.get("stops") or []:
            if s.get("slot") == "PP":
                continue
            print(
                f"  {s.get('slot')} {s.get('crs')} {s.get('name')} ptd={s.get('ptd')} pta={s.get('pta')} atd={s.get('atd')} ata={s.get('ata')}"
            )
