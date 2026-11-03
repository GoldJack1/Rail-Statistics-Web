import sqlite3
from pathlib import Path

base = Path("/home/darwin/rail-core/data")
for day in ["2026-10-29", "2026-10-30", "2026-10-31"]:
    p = base / f"day-{day}.sqlite"
    print("\n====", day, "exists", p.exists(), "====")
    if not p.exists():
        continue
    db = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    rows = db.execute(
        """
      SELECT rid, uid, headcode, toc, origin_crs, destination_crs, cancelled
      FROM services
      WHERE UPPER(IFNULL(toc,'')) IN ('CS','GW')
         OR UPPER(IFNULL(uid,'')) LIKE 'C04%'
      ORDER BY rid
    """
    ).fetchall()
    print("svc count", len(rows))
    for r in rows:
        rid = r["rid"]
        ends = db.execute(
            """
          SELECT seq, tiploc, crs, std, sta, atd, ata FROM calls
          WHERE rid=? AND IFNULL(is_passing,0)=0
          ORDER BY seq
        """,
            (rid,),
        ).fetchall()
        first = ends[0] if ends else None
        last = ends[-1] if ends else None

        def fmt(c):
            if not c:
                return "-"
            place = c["crs"] or c["tiploc"]
            booked = c["std"] or c["sta"] or ""
            act = c["atd"] or c["ata"] or ""
            return f"{place} {booked} act={act}"

        print(
            f"  {rid} uid={r['uid']} hc={r['headcode']} toc={r['toc']} "
            f"{r['origin_crs']}->{r['destination_crs']} calls={len(ends)} "
            f"{fmt(first)} -> {fmt(last)} can={r['cancelled']}"
        )
