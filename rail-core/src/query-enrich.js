/**
 * Query-dev calling-at enrichments: hide unreported ORM densify rows and
 * overlay TD berth times onto matching spine tipocs without writing sqlite.
 */
import { tdClock } from "./td-apply.js";
import { resolveSmartTiploc } from "./import-smart.js";
import { isNonPassengerLocation } from "./geometry-densify.js";

function corpusMeta(catalog, tiploc) {
  if (!catalog || !tiploc) return { name: "", crs: "" };
  try {
    const row = catalog
      .prepare(`SELECT name, crs FROM corpus WHERE tiploc = ? COLLATE NOCASE`)
      .get(String(tiploc).toUpperCase());
    return { name: row?.name || "", crs: row?.crs || "" };
  } catch {
    return { name: "", crs: "" };
  }
}

/** Keep ORM mids that are 3-letter passenger stations (RTT pass-throughs). Drop yards/jns. */
export function dropOrmDensifyPasses(calls, catalog) {
  return (calls || []).filter((c) => {
    if (String(c.actual_source || "") !== "orm") return true;
    const tpl = String(c.tiploc || "").toUpperCase();
    const meta = corpusMeta(catalog, tpl);
    const crs = String(c.crs || meta.crs || "").trim().toUpperCase();
    if (crs.length !== 3 || crs.startsWith("X")) return false;
    if (isNonPassengerLocation(tpl, { name: meta.name, crs })) return false;
    return true;
  });
}

export function dropUnreportedOrmPasses(calls, catalog) {
  return dropOrmDensifyPasses(calls, catalog);
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

function tdEventsForHeadcode(db, headcode) {
  if (!headcode || !db) return [];
  try {
    return db
      .prepare(
        `SELECT tiploc, area_id, berth, from_berth, json, received_at FROM td_events
         WHERE headcode = ? COLLATE NOCASE
         ORDER BY received_at`,
      )
      .all(String(headcode).toUpperCase());
  } catch {
    return [];
  }
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

export function overlayTdOnCalls(db, calls, headcode, catalog = null) {
  const byTpl = latestTdByTiploc(db, headcode);
  if (catalog) {
    const hints = new Set(
      (calls || []).map((c) => String(c.tiploc || "").toUpperCase()).filter(Boolean),
    );
    for (const row of tdEventsForHeadcode(db, headcode)) {
      if (row.tiploc) continue;
      const mapped = resolveSmartTiploc(catalog, row.area_id, row.berth, row.from_berth, {
        hintTiplocs: hints,
      });
      const tpl = mapped?.tiploc ? String(mapped.tiploc).toUpperCase() : "";
      if (!tpl || byTpl.has(tpl)) continue;
      byTpl.set(tpl, row);
    }
  }
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
