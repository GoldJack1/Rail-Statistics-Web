import { hhmm, liveKind, openCatalog, openDayDb, operatingDayYmd, upsertCall, upsertService } from "./db.js";

export function applyTrustMovement(dataDir, body) {
  const cat = openCatalog(dataDir);
  const stanox = String(body.loc_stanox || body.locStanox || "");
  const row = stanox
    ? cat.prepare(`SELECT tiploc, crs FROM corpus WHERE stanox = ?`).get(stanox)
    : null;
  cat.close();
  const db = openDayDb(dataDir, body.operating_day || operatingDayYmd());
  const rid = body.rid || body.train_id || body.trainId;
  if (!rid) {
    db.close();
    return false;
  }
  const actual = hhmm(body.actual || body.gbtt_timestamp || body.event_time);
  upsertService(db, {
    rid: String(rid),
    uid: body.uid ?? null,
    train_id: body.train_id ?? body.trainId ?? null,
    rs_id: null,
    toc: body.toc ?? null,
    operator_name: body.toc ?? null,
    origin_crs: null,
    origin_name: null,
    destination_crs: null,
    destination_name: null,
    via: null,
    service_type: body.service_type === "passenger" ? "passenger" : "freight",
    cancelled: body.event_type === "CANCELLATION" ? 1 : 0,
    cancel_reason: null,
    delay_reason: null,
    is_charter: 0,
    category: null,
    headcode: body.train_id ?? null,
    updated_at: Date.now(),
  });
  if (row?.tiploc || row?.crs) {
    const seq = Number(body.seq || Date.now() % 100000);
    upsertCall(db, {
      rid: String(rid),
      tiploc: row.tiploc || "",
      crs: row.crs || null,
      seq,
      is_passing: body.is_pass ? 1 : 0,
      cancelled: 0,
      platform: null,
      length_cars: null,
      formation: null,
      sta: null,
      std: hhmm(body.planned) || null,
      wta: null,
      wtd: null,
      wtp: null,
      ata: body.event_type === "ARRIVAL" ? actual : null,
      atd: body.event_type === "DEPARTURE" ? actual : null,
      atp: body.event_type === "PASS" ? actual : actual,
      eta: null,
      etd: null,
      etp: null,
      delay_minutes: body.delay_minutes ?? null,
      status: body.event_type ?? null,
      live_kind: liveKind({ ata: actual, atd: actual, atp: actual }),
      actual_source: "trust",
      updated_at: Date.now(),
    });
  }
  db.close();
  return true;
}
