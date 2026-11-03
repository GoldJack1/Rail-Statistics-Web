import json

path = "/home/darwin/rail-core/tt/schedule/toc-full.json"
need = '"CIF_train_uid":"C04570"'
with open(path, "r", errors="replace") as f:
    for i, line in enumerate(f):
        if need not in line:
            continue
        sch = json.loads(line).get("JsonScheduleV1") or {}
        seg = sch.get("schedule_segment")
        segs = seg if isinstance(seg, list) else [seg]
        print("---", i, sch.get("schedule_start_date"), sch.get("schedule_end_date"), sch.get("schedule_days_runs"), sch.get("CIF_stp_indicator"))
        for s in segs:
            locs = (s or {}).get("schedule_location") or []
            if isinstance(locs, dict):
                locs = [locs]
            pubs = []
            for loc in locs:
                pub = loc.get("public_departure") or loc.get("public_arrival") or ""
                if pub and pub != "0000":
                    pubs.append(f"{loc.get('tiploc_code')}:{pub}")
            print(" public", " ".join(pubs))
