import { hhmm, liveKind, upsertCall, upsertService } from "./db.js";

function locTime(v) {
  return hhmm(v) || null;
}

export function tiplocForCrs(catalog, crs) {
  const code = String(crs || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  const named = catalog
    .prepare(
      `SELECT tiploc FROM tiploc
       WHERE crs = ? AND name IS NOT NULL AND trim(name) != ''
       LIMIT 1`,
    )
    .get(code);
  if (named?.tiploc) return named.tiploc;
  return catalog.prepare(`SELECT tiploc FROM tiploc WHERE crs = ? LIMIT 1`).get(code)?.tiploc || null;
}

function matchCall(db, catalog, rid, loc) {
  const crs = String(loc.location || loc.crs || "").toUpperCase();
  if (!crs) return null;
  const sta = locTime(loc.gbtt_pta);
  const std = locTime(loc.gbtt_ptd);
  const tpl = tiplocForCrs(catalog, crs);
  const rows = db
    .prepare(
      `SELECT tiploc, is_passing, ata, atd, sta, std FROM calls
       WHERE rid = ? AND IFNULL(is_passing, 0) = 0
         AND (
           UPPER(IFNULL(crs, '')) = ?
           OR (? IS NOT NULL AND tiploc = ?)
         )`,
    )
    .all(rid, crs, tpl, tpl);
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  return rows.find((r) => (std && r.std === std) || (sta && r.sta === sta)) || rows[0];
}

/** Merge HSP serviceDetails into a day DB. Public stops only; never overwrites pass rows. */
export function applyHspDetails(db, catalog, details, ymd, targetRid) {
  const sad = details?.serviceAttributesDetails || details || {};
  const rid = String(targetRid || sad.rid || details?.rid || "");
  const locs = sad.locations || [];
  if (!rid || !locs.length) return { ok: false, filled: 0 };

  const first = locs[0];
  const last = locs[locs.length - 1];
  const reason = locs.map((l) => l.late_canc_reason).find((r) => r && String(r).trim()) || null;
  upsertService(
    db,
    {
      rid,
      uid: sad.uid || rid.slice(8) || null,
      train_id: null,
      rs_id: null,
      toc: sad.toc_code || null,
      operator_name: sad.toc_code || null,
      origin_crs: first.location || null,
      origin_name: null,
      destination_crs: last.location || null,
      destination_name: null,
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: reason,
      is_charter: 0,
      category: null,
      headcode: null,
      updated_at: Date.now(),
    },
    { overlay: true },
  );

  let filled = 0;
  for (const loc of locs) {
    const crs = String(loc.location || loc.crs || "").toUpperCase();
    if (!crs) continue;
    const ata = locTime(loc.actual_ta || loc.actual_arrival);
    const atd = locTime(loc.actual_td || loc.actual_departure);
    const sta = locTime(loc.gbtt_pta);
    const std = locTime(loc.gbtt_ptd);
    const existing = matchCall(db, catalog, rid, loc);
    if (!existing || existing.is_passing) continue;
    const live_kind = liveKind({ ata, atd });
    upsertCall(
      db,
      {
        rid,
        tiploc: existing.tiploc,
        crs,
        seq: 0,
        is_passing: 0,
        cancelled: 0,
        platform: null,
        length_cars: null,
        formation: null,
        sta,
        std,
        wta: null,
        wtd: null,
        wtp: null,
        ata,
        atd,
        atp: null,
        eta: null,
        etd: null,
        etp: null,
        delay_minutes: null,
        status: loc.late_canc_reason || null,
        live_kind,
        actual_source: ata || atd ? "hsp" : null,
        updated_at: Date.now(),
      },
      { overlay: true, fillOnly: true },
    );
    if ((ata && !existing.ata) || (atd && !existing.atd)) filled++;
  }

  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(`hsp_sealed_${rid}`, ymd || "");
  return { ok: true, filled, rid };
}
