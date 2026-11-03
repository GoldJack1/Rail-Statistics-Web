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
    svc = get(port, "/api/service/202610296704568")
    print("port", port, svc.get("rid"))
    for a in svc.get("associations") or []:
        print(" ", a.get("otherRid"), a.get("otherTrainId"), a.get("otherDestinationName"))
