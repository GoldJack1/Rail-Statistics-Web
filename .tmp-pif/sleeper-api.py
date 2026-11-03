import json
import os
import urllib.request

key = os.environ["INTERNAL_API_KEY"]

def get(path):
    req = urllib.request.Request(
        "http://127.0.0.1:4001" + path,
        headers={"x-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

board = get("/api/departures/EUS?hours=18&passengers=1")
print("EUS generated", board.get("generatedAt"), "hist", board.get("historicalDate"))
for d in board.get("departures") or []:
    tid = str(d.get("trainId") or "")
    toc = str(d.get("toc") or "")
    if tid in ("1S25", "1S26") or toc == "CS":
        print(
            "BOARD",
            d.get("scheduledTime"),
            tid,
            d.get("rid"),
            d.get("uid"),
            toc,
            d.get("destinationName"),
            d.get("liveKind"),
            d.get("liveTime"),
            d.get("scheduledAt"),
        )

for rid in ("202610306704570", "202610296704568", "C04570"):
    svc = get("/api/service/" + rid)
    stops = svc.get("stops") or []
    public = [s for s in stops if s.get("slot") != "PP"]
    print(
        "\nSERVICE",
        rid,
        "->",
        svc.get("rid"),
        svc.get("ssd"),
        svc.get("uid"),
        svc.get("headcode") or svc.get("trainId"),
        "stops",
        len(stops),
        "public",
        len(public),
    )
    if public:
        a, b = public[0], public[-1]
        print("  ends", a.get("name"), a.get("ptd") or a.get("pta"), "ata", a.get("atd") or a.get("ata"), "->", b.get("name"), b.get("pta") or b.get("ptd"), "ata", b.get("ata") or b.get("atd"))
    acted = [s for s in public if s.get("ata") or s.get("atd")]
    print("  public with actuals", len(acted))
    assocs = svc.get("associations") or []
    print("  associations", len(assocs))
    for a in assocs[:8]:
        print(
            "   ",
            a.get("category"),
            a.get("role"),
            a.get("otherRid"),
            a.get("otherTrainId"),
            a.get("otherOriginName"),
            "->",
            a.get("otherDestinationName"),
        )
