/**
 * Query-dev calling-at enrichments: hide unreported ORM densify rows and
 * overlay TD berth times onto matching spine tipocs without writing sqlite.
 */
import { hhmmss } from "./db.js";
import { tdClockPrecise } from "./td-apply.js";
import { resolveSmartTiploc } from "./import-smart.js";
import { isNonPassengerLocation, isSignalOrElocTiploc } from "./geometry-densify.js";
import { callClock, interpolateHm } from "./tiploc-graph.js";

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

function isNamedJunction(name) {
  return /\bjn\b|junction/i.test(String(name || ""));
}

/**
 * ORM densify rows stay when they are a passenger station or a named junction.
 * Yards, depots and signals still drop. Schedule, TRUST, TD and Darwin rows stay.
 */
export function dropOrmDensifyPasses(calls, catalog) {
  return (calls || []).filter((c) => {
    if (String(c.actual_source || "") !== "orm") return true;
    const tpl = String(c.tiploc || "").toUpperCase();
    const meta = corpusMeta(catalog, tpl);
    const name = meta.name || "";
    const crs = String(c.crs || meta.crs || "").trim().toUpperCase();
    if (isSignalOrElocTiploc(tpl) || isNonPassengerLocation(tpl, { name, crs })) return false;
    if (crs.length === 3 && !crs.startsWith("X")) return true;
    return isNamedJunction(name);
  });
}

export function dropUnreportedOrmPasses(calls, catalog) {
  return dropOrmDensifyPasses(calls, catalog);
}

function clockFromTrust(value) {
  const s = String(value || "").trim();
  const iso = /T(\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (iso) return iso[3] === "00" ? `${iso[1]}:${iso[2]}` : `${iso[1]}:${iso[2]}:${iso[3]}`;
  if (/^\d{1,2}:\d{2}/.test(s)) return s.match(/^\d{1,2}:\d{2}(?::\d{2})?/)[0];
  return hhmmss(s);
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
  return tdClockPrecise(body?.time || body?.report_time, row.received_at);
}

function minuteOf(value) {
  const m = /^(\d{1,2}:\d{2})/.exec(String(value || ""));
  return m ? m[1] : "";
}

/** Keep a stored HH:MM when the TD step is the same minute and has seconds. */
function withTdSeconds(call, precise) {
  if (!precise || precise.split(":").length < 3) return call;
  const minute = minuteOf(precise);
  const next = { ...call };
  for (const key of ["ata", "atd", "atp"]) {
    const current = next[key];
    if (!current || minuteOf(current) !== minute || String(current).split(":").length >= 3) continue;
    next[key] = precise;
  }
  return next;
}

function minToHm(mins) {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function hmToMin(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const sequenceCache = new Map();

/** Every stored calling pattern for the day, in schedule order. */
export function scheduleSequences(db, ymd) {
  const key = String(ymd || "");
  if (sequenceCache.has(key)) return sequenceCache.get(key);
  let rows = [];
  try {
    rows = db.prepare(`SELECT rid, tiploc, seq FROM calls WHERE tiploc IS NOT NULL ORDER BY rid, seq`).all();
  } catch {
    return [];
  }
  const byRid = new Map();
  for (const row of rows) {
    const tpl = String(row.tiploc).toUpperCase();
    const list = byRid.get(row.rid) || [];
    if (list.at(-1) !== tpl) list.push(tpl);
    byRid.set(row.rid, list);
  }
  const sequences = [...byRid.values()];
  sequenceCache.set(key, sequences);
  return sequences;
}

function modalMids(sequences, a, b, c) {
  const tallies = new Map();
  for (const seq of sequences) {
    const ia = seq.indexOf(a);
    if (ia < 0) continue;
    let ib = -1;
    for (let j = ia + 1; j < seq.length && j <= ia + 8; j++) {
      if (seq[j] === b) {
        ib = j;
        break;
      }
    }
    if (ib < 0) continue;
    if (c) {
      let ic = -1;
      for (let j = ib + 1; j < seq.length && j <= ib + 8; j++) {
        if (seq[j] === c) {
          ic = j;
          break;
        }
      }
      if (ic < 0) continue;
    }
    const key = seq.slice(ia + 1, ib).join(">");
    if (!key) continue;
    tallies.set(key, (tallies.get(key) || 0) + 1);
  }
  const best = [...tallies.entries()].sort((x, y) => y[1] - x[1])[0];
  if (!best || best[1] < 3) return [];
  return best[0].split(">").filter((tpl) => tpl && !isSignalOrElocTiploc(tpl));
}

/**
 * Fill each booked gap with the path other trains use between the same
 * stops, and only when those trains also reach the next booked stop.
 */
export function insertSchedulePasses(calls, sequences) {
  const spine = (calls || []).filter((c) => c?.tiploc);
  if (spine.length < 2 || !sequences?.length) return spine;
  const present = new Set(spine.map((c) => String(c.tiploc).toUpperCase()));
  const tips = spine.map((c) => String(c.tiploc).toUpperCase());
  const out = [];
  for (let i = 0; i < spine.length; i++) {
    if (i > 0) {
      const mids = modalMids(sequences, tips[i - 1], tips[i], tips[i + 1] || null).filter(
        (tpl) => !present.has(tpl),
      );
      const t0 = callClock(spine[i - 1]);
      const t1 = callClock(spine[i]);
      mids.forEach((tpl, j) => {
        present.add(tpl);
        const wtp = interpolateHm(t0, t1, j, mids.length);
        out.push({
          tiploc: tpl,
          crs: null,
          is_passing: 1,
          cancelled: 0,
          platform: null,
          wta: null,
          wtd: null,
          wtp,
          etp: wtp,
          ata: null,
          atd: null,
          atp: null,
          live_kind: "est",
          actual_source: "inferred",
        });
      });
    }
    out.push(spine[i]);
  }
  return out.map((c, seq) => ({ ...c, seq }));
}

function callBookedMin(call) {
  return hmToMin(call?.wtp || call?.wtd || call?.wta || call?.ptd || call?.pta);
}

function callActualMin(call) {
  return hmToMin(call?.atp || call?.atd || call?.ata);
}

function tiplocForStanox(catalog, stanox) {
  if (!catalog || !stanox) return "";
  try {
    const row = catalog.prepare(`SELECT tiploc FROM corpus WHERE stanox = ?`).get(String(stanox));
    return row?.tiploc ? String(row.tiploc).toUpperCase() : "";
  } catch {
    return "";
  }
}

/**
 * Inferred passes are not stored, so TRUST never lands on them at ingest.
 * Copy a matching TRUST actual onto the row. Once a later call has a real
 * report, shift the remaining inferred clocks by that lateness and mark the
 * ones already behind the train as passed.
 */
export function applyLiveToInferred(db, calls, trainId, catalog = null) {
  const rows = (calls || []).map((c) => ({ ...c }));
  const byTpl = new Map();
  if (db && trainId) {
    let events = [];
    try {
      events = db
        .prepare(
          `SELECT loc_stanox, actual, event_type FROM trust_events
           WHERE train_id = ? AND actual IS NOT NULL AND actual != ''
           ORDER BY received_at`,
        )
        .all(String(trainId));
    } catch {
      events = [];
    }
    for (const ev of events) {
      const tpl = tiplocForStanox(catalog, ev.loc_stanox);
      if (tpl) byTpl.set(tpl, ev);
    }
  }
  for (const call of rows) {
    if (call.atp || call.atd || call.ata) continue;
    const ev = byTpl.get(String(call.tiploc || "").toUpperCase());
    if (!ev?.actual) continue;
    const kind = String(ev.event_type || "").toUpperCase();
    if (Number(call.is_passing) || kind === "PASS") {
      call.atp = ev.actual;
      call.live_kind = "actual";
      call.actual_source = "trust";
    }
  }
  const reported = rows
    .map((call, index) => ({ index, booked: callBookedMin(call), actual: callActualMin(call) }))
    .filter((row) => row.actual != null && row.booked != null);
  if (!reported.length) return rows;
  for (let i = 0; i < rows.length; i++) {
    const call = rows[i];
    if (String(call.actual_source || "") !== "inferred") continue;
    if (call.atp || call.atd || call.ata) continue;
    const booked = callBookedMin(call);
    if (booked == null) continue;
    const next = reported.find((row) => row.index > i);
    const prev = [...reported].reverse().find((row) => row.index < i);
    const anchor = next || prev;
    if (!anchor) continue;
    let delta = anchor.actual - anchor.booked;
    if (delta < -12 * 60) delta += 1440;
    else if (delta > 12 * 60) delta -= 1440;
    const clock = minToHm(booked + delta);
    const passed = reported.some((row) => row.index > i);
    if (passed) {
      call.atp = clock;
      call.etp = null;
      call.live_kind = "actual";
    } else {
      call.etp = clock;
      call.live_kind = "est";
    }
  }
  return rows;
}

function tdByTiploc(db, headcode, catalog, calls) {
  const byTpl = latestTdByTiploc(db, headcode);
  if (!catalog) return byTpl;
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
  return byTpl;
}

function callMinute(call) {
  return hmToMin(call?.atp || call?.atd || call?.ata || call?.etp || call?.etd || call?.eta || call?.wtp || call?.wtd || call?.wta);
}

/**
 * Place a TRUST or TD location that is not already on the list.
 * The clock decides which existing gap it sits in. It does not build a route.
 */
export function insertReportedPasses(calls, reports) {
  const out = (calls || []).map((c) => ({ ...c }));
  const present = new Set(out.map((c) => String(c.tiploc || "").toUpperCase()));
  const pending = [];
  for (const report of reports || []) {
    const tiploc = String(report.tiploc || "").toUpperCase();
    if (!tiploc || present.has(tiploc) || report.minute == null || !report.clock) continue;
    present.add(tiploc);
    pending.push({ ...report, tiploc });
  }
  pending.sort((a, b) => a.minute - b.minute);
  for (const report of pending) {
    let at = out.length;
    for (let i = 0; i < out.length; i++) {
      const minute = callMinute(out[i]);
      if (minute == null) continue;
      let delta = minute - report.minute;
      if (delta < -12 * 60) delta += 1440;
      else if (delta > 12 * 60) delta -= 1440;
      if (delta > 0) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, {
      tiploc: report.tiploc,
      crs: report.crs || null,
      is_passing: 1,
      cancelled: 0,
      wtp: null,
      atp: report.clock,
      live_kind: "actual",
      actual_source: report.source,
    });
  }
  return out.map((c, seq) => ({ ...c, seq }));
}

/** TRUST movements and SMART-mapped TD steps for this train. TD wins on the same TIPLOC. */
export function collectReportedPasses(db, calls, trainId, headcode, catalog = null) {
  const byTpl = new Map();
  if (db && trainId && catalog) {
    let events = [];
    try {
      events = db
        .prepare(
          `SELECT loc_stanox, actual FROM trust_events
           WHERE train_id = ? AND actual IS NOT NULL AND actual != ''
           ORDER BY received_at`,
        )
        .all(String(trainId));
    } catch {
      events = [];
    }
    for (const ev of events) {
      const tiploc = tiplocForStanox(catalog, ev.loc_stanox);
      const clock = clockFromTrust(ev.actual);
      const minute = hmToMin(clock);
      if (!tiploc || minute == null) continue;
      const meta = corpusMeta(catalog, tiploc);
      byTpl.set(tiploc, { tiploc, crs: meta.crs || null, clock, minute, source: "trust" });
    }
  }
  for (const [tiploc, row] of tdByTiploc(db, headcode, catalog, calls)) {
    const clock = actualFromTdEvent(row);
    const minute = hmToMin(clock);
    if (!tiploc || minute == null) continue;
    const meta = corpusMeta(catalog, tiploc);
    byTpl.set(tiploc, { tiploc, crs: meta.crs || null, clock, minute, source: "td" });
  }
  return [...byTpl.values()];
}

export function overlayTdOnCalls(db, calls, headcode, catalog = null) {
  const byTpl = tdByTiploc(db, headcode, catalog, calls);
  if (!byTpl.size) return calls || [];
  return (calls || []).map((c) => {
    const ev = byTpl.get(String(c.tiploc || "").toUpperCase());
    const actual = ev ? actualFromTdEvent(ev) : null;
    if (c.ata || c.atd || c.atp) return actual ? withTdSeconds(c, actual) : c;
    if (!actual) return c;
    if (Number(c.is_passing)) {
      return { ...c, atp: actual, live_kind: "actual", actual_source: c.actual_source || "td" };
    }
    return c;
  });
}
