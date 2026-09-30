/**
 * Greedy bash planner on the day's Darwin/TRUST calls.
 * TRUST actuals win via COALESCE(atd/ata, etd/eta, std/sta).
 */
export function planBash(db, nameOf, body) {
  const startCrs = String(body.start?.crs || body.start || "").toUpperCase();
  const endCrs = String(body.end?.crs || body.end || "").toUpperCase();
  const visit = (body.visit || body.visits || []).map((v) => String(v?.crs || v).toUpperCase()).filter(Boolean);
  const date = body.date;
  const at = String(body.at || "06:00").slice(0, 5);
  const wait = Number(body.safeWaitMin ?? 5);
  if (!startCrs || !endCrs || !date) {
    return { ok: false, error: "start, end and date are required" };
  }
  const stops = [startCrs, ...visit.filter((c) => c !== startCrs && c !== endCrs), endCrs];
  const hops = [];
  let clock = at;
  let arriveAtFrom = null;
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    const after = addMinutes(clock, i === 0 ? 0 : wait);
    const hop = nextTrain(db, from, to, after, nameOf);
    if (!hop) {
      return {
        ok: false,
        error: `No Darwin/TRUST path ${from} → ${to} after ${after} on ${date}`,
        date,
        start: { crs: startCrs, name: nameOf(startCrs) },
        end: { crs: endCrs, name: nameOf(endCrs) },
        hops,
      };
    }
    hop.waitMin = i === 0 ? 0 : wait;
    hop.arriveAtFrom = arriveAtFrom;
    hops.push(hop);
    clock = hop.arr;
    arriveAtFrom = hop.arr;
  }
  const first = hops[0];
  const last = hops[hops.length - 1];
  return {
    ok: true,
    date,
    at,
    start: { crs: startCrs, name: nameOf(startCrs) },
    end: { crs: endCrs, name: nameOf(endCrs) },
    safeWaitMin: wait,
    hops,
    finishAt: last?.arr,
    totalMin: first && last ? diffMin(first.dep, last.arr) : 0,
    caution: "Connections use live Darwin calling points plus TRUST actuals when present. Full CIF coverage arrives after the 04:00 timetable ingest.",
  };
}

function addMinutes(hhmm, add) {
  const [h, m] = String(hhmm).split(":").map(Number);
  let t = h * 60 + m + add;
  t = ((t % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function diffMin(a, b) {
  const pa = String(a).split(":").map(Number);
  const pb = String(b).split(":").map(Number);
  let d = pb[0] * 60 + pb[1] - (pa[0] * 60 + pa[1]);
  if (d < 0) d += 1440;
  return d;
}

function nextTrain(db, from, to, after, nameOf) {
  const row = db
    .prepare(
      `SELECT a.rid,
              COALESCE(a.atd, a.etd, a.std, a.wtd) AS dep,
              COALESCE(b.ata, b.eta, b.sta, b.wta) AS arr,
              a.platform AS fromPlat,
              b.platform AS toPlat,
              a.actual_source AS fromSrc,
              b.actual_source AS toSrc,
              s.headcode, s.uid, s.toc
       FROM calls a
       JOIN calls b ON b.rid = a.rid
       JOIN services s ON s.rid = a.rid
       WHERE a.crs = ? AND b.crs = ?
         AND IFNULL(a.is_passing, 0) = 0 AND IFNULL(b.is_passing, 0) = 0
         AND COALESCE(a.atd, a.etd, a.std, a.wtd) >= ?
         AND COALESCE(b.ata, b.eta, b.sta, b.wta) > COALESCE(a.atd, a.etd, a.std, a.wtd)
       ORDER BY dep
       LIMIT 1`
    )
    .get(from, to, after);
  if (!row?.rid) return null;
  const trainId = row.headcode || row.uid || "";
  return {
    fromCrs: from,
    fromName: nameOf(from),
    toCrs: to,
    toName: nameOf(to),
    dep: row.dep,
    arr: row.arr,
    waitMin: 0,
    boardPlatform: row.fromPlat,
    alightPlatform: row.toPlat,
    riskyConnections: [],
    legs: [
      {
        rid: row.rid,
        trainId,
        fromCrs: from,
        fromName: nameOf(from),
        toCrs: to,
        toName: nameOf(to),
        dep: row.dep,
        arr: row.arr,
        fromPlat: row.fromPlat,
        toPlat: row.toPlat,
        board: null,
      },
    ],
  };
}
