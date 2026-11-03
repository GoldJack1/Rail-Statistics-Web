from pathlib import Path
import shutil

root = Path("/home/darwin/rail-core-dev/src")
backup = Path("/tmp/backup-darwin-calling")
backup.mkdir(exist_ok=True)
for name in ("query-server.js", "query-enrich.js"):
    shutil.copy2(root / name, backup / name)

server = root / "query-server.js"
text = server.read_text()
old_import = "insertIntermediateStations, insertReportedPasses, insertSegmentJunctions, namedJunctionPoints, passengerStationCrs, overlayTdOnCalls, reportsForService, retimeInferredPasses, scheduleSequences, settleUnreportedPasses, tiplocCoords"
new_import = "insertReportedPasses, overlayTdOnCalls, reportsForService, retimeInferredPasses, settleUnreportedPasses, tiplocCoords"
old_block = """    calls = overlayTdOnCalls(db, calls, headcode, catalog);
    const sequences = scheduleSequences(db, ymd);
    const locate = new Set(calls.map((c) => String(c.tiploc || "").toUpperCase()));
    for (const seq of sequences) {
      for (let i = 0; i < seq.length - 1; i++) {
        if (locate.has(seq[i])) locate.add(seq[i + 1]);
      }
    }
    const segmentCoords = tiplocCoords(catalog, locate);
    calls = insertSegmentJunctions(calls, sequences, segmentCoords, namedJunctionPoints(catalog));
    const stationCrs = passengerStationCrs(catalog);
    let stationGeo = null;
    try {
      stationGeo = catalog.prepare(`SELECT easting AS e, northing AS n FROM tiploc_geo WHERE tiploc = ?`);
    } catch {
      stationGeo = null;
    }
    calls = insertIntermediateStations(
      calls,
      sequences,
      (tiploc) => stationCrs.get(String(tiploc || "").toUpperCase()) || "",
      (tiploc) => {
        const key = String(tiploc || "").toUpperCase();
        if (segmentCoords.has(key)) return segmentCoords.get(key);
        if (!stationGeo) return null;
        const row = stationGeo.get(key);
        if (row?.e == null || row?.n == null) return null;
        const point = { e: Number(row.e), n: Number(row.n) };
        segmentCoords.set(key, point);
        return point;
      },
    );
"""
new_block = "    calls = overlayTdOnCalls(db, calls, headcode, catalog);\n"
if old_import not in text or old_block not in text:
    raise SystemExit("server mismatch")
server.write_text(text.replace(old_import, new_import, 1).replace(old_block, new_block, 1))

enrich = root / "query-enrich.js"
body = enrich.read_text()
old_check = """    if (!tiploc || present.has(tiploc) || report.minute == null || !report.clock) continue;
    if (isNonPassengerLocation(tiploc, { name: report.name, crs: report.crs })) continue;"""
new_check = """    if (!tiploc || present.has(tiploc) || report.minute == null || !report.clock) continue;
    if (report.source === "td" && !String(report.name || "").trim()) continue;
    if (isNonPassengerLocation(tiploc, { name: report.name, crs: report.crs })) continue;"""
if old_check not in body:
    shutil.copy2(backup / "query-server.js", server)
    raise SystemExit("enrich mismatch")
enrich.write_text(body.replace(old_check, new_check, 1))
print("patched")
