/**
 * Overnight HSP should not call serviceDetails for every timetable hole.
 * Last night ~85% of those calls 404'd. Darwin forecast-only RIDs (eta/etd, no actuals
 * by seal time) never got HSP fills; timetable-only RIDs sometimes did.
 */
export function ridsNeedingHspSeal(db, opts = {}) {
  const skipForecastOnly = opts.skipForecastOnly !== false;
  const sql = skipForecastOnly
    ? `SELECT s.rid FROM services s
       WHERE IFNULL(s.service_type, 'passenger') != 'freight'
         AND IFNULL(s.is_charter, 0) = 0
         AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.key IN ('hsp_sealed_' || s.rid, 'hsp_miss_' || s.rid))
         AND EXISTS (
           SELECT 1 FROM calls c
           WHERE c.rid = s.rid AND IFNULL(c.is_passing, 0) = 0
             AND (c.sta IS NOT NULL OR c.std IS NOT NULL)
             AND c.ata IS NULL AND c.atd IS NULL
         )
         AND (
           EXISTS (
             SELECT 1 FROM calls c2
             WHERE c2.rid = s.rid AND (c2.ata IS NOT NULL OR c2.atd IS NOT NULL OR c2.atp IS NOT NULL)
           )
           OR NOT EXISTS (
             SELECT 1 FROM calls c3
             WHERE c3.rid = s.rid AND (
               c3.ata IS NOT NULL OR c3.atd IS NOT NULL OR c3.atp IS NOT NULL
               OR c3.eta IS NOT NULL OR c3.etd IS NOT NULL OR c3.etp IS NOT NULL
             )
           )
         )`
    : `SELECT s.rid FROM services s
       WHERE IFNULL(s.service_type, 'passenger') != 'freight'
         AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.key IN ('hsp_sealed_' || s.rid, 'hsp_miss_' || s.rid))
         AND EXISTS (
           SELECT 1 FROM calls c
           WHERE c.rid = s.rid AND IFNULL(c.is_passing, 0) = 0
             AND (c.sta IS NOT NULL OR c.std IS NOT NULL)
             AND c.ata IS NULL AND c.atd IS NULL
         )`;
  return db.prepare(sql).all().map((r) => r.rid);
}
