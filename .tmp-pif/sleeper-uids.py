import json
import os
import sqlite3
import urllib.request
from pathlib import Path

key = os.environ.get("INTERNAL_API_KEY", "")

def get(port, path):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}" + path,
        headers={"x-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

print("UID collisions for Aberdeen portions")
for day in ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]:
    p = Path("/home/darwin/rail-core/data") / f"day-{day}.sqlite"
    if not p.exists():
        continue
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    rows = db.execute(
        """
        SELECT rid, uid, headcode, origin_name, destination_name
        FROM services
        WHERE rid IN ('202610286704542','202610296704542','202610306704542','202610316704544')
           OR UPPER(IFNULL(uid,'')) IN ('C04542','6704542','C04544','6704544')
        """
    ).fetchall()
    print(day, rows)

for port in (4001, 4002):
    try:
        svc = get(port, "/api/service/202610296704568")
    except Exception as e:
        print("port", port, e)
        continue
    print("\nPORT", port, "last night", svc.get("rid"), svc.get("ssd"))
    for a in svc.get("associations") or []:
        print(" ", a.get("otherRid"), a.get("otherUid"), a.get("otherTrainId"), a.get("otherDestinationName"))
    svc2 = get(port, "/api/service/202610306704570")
    print("PORT", port, "tonight", svc2.get("rid"), svc2.get("ssd"), "public", sum(1 for s in svc2.get("stops") or [] if s.get("slot") != "PP"))
    for a in svc2.get("associations") or []:
        print(" ", a.get("otherRid"), a.get("otherUid"), a.get("otherTrainId"), a.get("otherDestinationName"))
