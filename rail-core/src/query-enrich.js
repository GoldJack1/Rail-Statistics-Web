/**
 * Query-dev calling-at enrichments: hide unreported ORM densify rows and
 * overlay TD berth times onto matching spine tipocs without writing sqlite.
 */
import { tdClock } from "./td-apply.js";

export function dropUnreportedOrmPasses(calls) {
  return (calls || []).filter((c) => {
    if (String(c.actual_source || "") !== "orm") return true;
    return Boolean(c.ata || c.atd || c.atp);
  });
}

function latestTdByTiploc(db, headcode) {
  if (!headcode || !db) return new Map();
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT tiploc, json, received_at FROM td_events
         WHERE headcode = ? COLLATE NOCASE AND tiploc IS NOT NULL AND tiploc != ''
         ORDER BY received_at`,
      )
      .all(String(headcode).toUpperCase());
  } catch {
    return new Map();
  }
  const byTpl = new Map();
  for (const row of rows) {
    byTpl.set(String(row.tiploc).toUpperCase(), row);
  }
  return byTpl;
}

function actualFromTdEvent(row) {
  let parsed = null;
  try {
    parsed = row.json ? JSON.parse(row.json) : null;
  } catch {
    parsed = null;
  }
  const body = parsed && typeof parsed === "object" ? Object.values(parsed).find((v) => v && typeof v === "object") : null;
  return tdClock(body?.time || body?.report_time, row.received_at);
}

export function overlayTdOnCalls(db, calls, headcode) {
  const byTpl = latestTdByTiploc(db, headcode);
  if (!byTpl.size) return calls || [];
  return (calls || []).map((c) => {
    if (c.ata || c.atd || c.atp) return c;
    const ev = byTpl.get(String(c.tiploc || "").toUpperCase());
    if (!ev) return c;
    const actual = actualFromTdEvent(ev);
    if (!actual) return c;
    if (Number(c.is_passing)) {
      return { ...c, atp: actual, live_kind: "actual", actual_source: c.actual_source || "td" };
    }
    return c;
  });
}
