/**
 * Query-dev calling-at enrichments: hide unreported ORM densify rows and
 * overlay TD berth times onto matching spine tipocs without writing sqlite.
 */
import { hhmmss } from "./db.js";
import { tdClockPrecise } from "./td-apply.js";
import { resolveSmartTiploc } from "./import-smart.js";
import { isNonPassengerLocation, isSignalOrElocTiploc } from "./geometry-densify.js";
import { interpolateHm } from "./tiploc-graph.js";
import { actualBelongsToBooked, isSignallingBerth } from "./td-match.js";

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

/** Dev list: a place with no feed report is not a calling point. */
export function dropUnreportedPasses(calls) {
  return (calls || []).filter((c) => {
    const src = String(c.actual_source || "");
    if (src === "inferred") return false;
    if (src === "orm") return Boolean(c.ata || c.atd || c.atp);
    return true;
  });
}

/** The booked visit this clock belongs to. A filled visit is not skipped, so the other passing of the same junction is left alone. */
function nearestBookedVisitIndex(calls, tiploc, clock) {
  const key = String(tiploc || "").toUpperCase();
  const minute = hmToMin(clock);
  let best = -1;
  let bestDelta = Infinity;
  calls.forEach((call, index) => {
    if (String(call.tiploc || "").toUpperCase() !== key) return;
    const booked = hmToMin(call.wtp || call.wtd || call.wta || call.std || call.sta);
    let delta = booked == null || minute == null ? 0 : Math.abs(booked - minute);
    if (delta > 12 * 60) delta = 1440 - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  return best;
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
        `SELECT tiploc, berth, json, received_at FROM td_events
         WHERE headcode = ? COLLATE NOCASE AND tiploc IS NOT NULL AND tiploc != ''
         ORDER BY received_at`,
      )
      .all(String(headcode).toUpperCase());
  } catch {
    return new Map();
  }
  const byTpl = new Map();
  for (const row of rows) {
    if (isSignallingBerth(row.berth)) continue;
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

/**
 * TD is stored by headcode, so the morning train's steps land on the evening
 * schedule. Drop a TD actual that is not this call's booked time.
 */
export function dropForeignTdActuals(calls) {
  return (calls || []).map((call) => {
    if (String(call.actual_source || "") !== "td") return call;
    const booked = callBookedMin(call);
    const actual = callActualMin(call);
    if (booked == null || actual == null) return call;
    if (actualBelongsToBooked(booked, actual)) return call;
    const next = { ...call, ata: null, atd: null, atp: null };
    const estimate = next.eta || next.etd || next.etp;
    if (next.live_kind === "actual" || next.live_kind === "actual-arr") {
      next.live_kind = estimate ? "est" : null;
    }
    return next;
  });
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
function onSegment(a, b, point, slack = 400) {
  if (!a || !b || !point) return null;
  const abx = b.e - a.e;
  const aby = b.n - a.n;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1) return null;
  const t = ((point.e - a.e) * abx + (point.n - a.n) * aby) / len2;
  if (t <= 0.02 || t >= 0.98) return null;
  const dx = point.e - (a.e + t * abx);
  const dy = point.n - (a.n + t * aby);
  if (Math.hypot(dx, dy) > slack) return null;
  return t;
}

function clockSeconds(value) {
  const text = String(value || "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!m) return null;
  let secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
  if (!m[3] && /½/.test(text)) secs += 30;
  return secs;
}

function formatClock(seconds, withSeconds) {
  const wrapped = ((Math.round(seconds) % 86400) + 86400) % 86400;
  const hh = String(Math.floor(wrapped / 3600)).padStart(2, "0");
  const mm = String(Math.floor((wrapped % 3600) / 60)).padStart(2, "0");
  const ss = String(wrapped % 60).padStart(2, "0");
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

function interpolateClock(a, b, t) {
  const as = clockSeconds(a);
  const bs = clockSeconds(b);
  if (as == null || bs == null) return null;
  let delta = bs - as;
  if (delta < -12 * 3600) delta += 86400;
  else if (delta < 0) delta = 0;
  const withSeconds = String(a).split(":").length > 2 || String(b).split(":").length > 2;
  return formatClock(as + delta * t, withSeconds);
}

function reportedClock(call) {
  return call?.atp || call?.atd || call?.ata || null;
}

function strictlyInside(value, before, after) {
  const t = clockSeconds(value);
  const a = clockSeconds(before);
  const b = clockSeconds(after);
  if (t == null || a == null || b == null || b <= a) return true;
  return t > a && t <= b;
}

/**
 * Ordering can move a guessed junction to the other side of a station and
 * leave its clock behind. Put that clock back between the calls it now sits between.
 */
export function retimeInferredPasses(calls) {
  const rows = (calls || []).map((c) => ({ ...c }));
  for (let i = 0; i < rows.length; i++) {
    const call = rows[i];
    if (String(call.actual_source || "") !== "inferred") continue;
    const prev = [...rows.slice(0, i)].reverse().find((row) => leaveClock(row) || reportedLeave(row));
    const next = rows.slice(i + 1).find((row) => arriveClock(row) || reportedArrive(row));
    if (!prev || !next) continue;
    const guess = guessBetween(prev, next, 0.5);
    if (call.wtp && leaveClock(prev) && arriveClock(next) && !strictlyInside(call.wtp, leaveClock(prev), arriveClock(next)) && guess.wtp) {
      call.wtp = guess.wtp;
      if (!reportedLeave(call) && !reportedArrive(call)) call.etp = guess.etp || guess.wtp;
    }
    const live = reportedClock(call);
    const prevLive = reportedLeave(prev);
    const nextLive = reportedArrive(next);
    if (live && prevLive && nextLive && !strictlyInside(live, prevLive, nextLive) && guess.atp) {
      if (call.atp) call.atp = guess.atp;
      else if (call.atd) call.atd = guess.atp;
      else call.ata = guess.atp;
    }
  }
  return rows;
}

/** A pass booked on the way out of a call cannot show an earlier clock than that call. */
function notBefore(value, previous) {
  const got = clockSeconds(value);
  const prev = clockSeconds(previous);
  if (got == null || prev == null || got > prev) return value;
  return formatClock(prev + 60, false);
}

/** The train leaves a call at its departure. A pass has only one clock. */
function leaveClock(call) {
  return call?.wtd || call?.wtp || call?.std || call?.wta || call?.sta || null;
}

/** The train reaches the next call at its arrival. A pass has only one clock. */
function arriveClock(call) {
  return call?.wta || call?.wtp || call?.sta || call?.wtd || call?.std || null;
}

function reportedLeave(call) {
  return call?.atd || call?.atp || call?.ata || null;
}

function reportedArrive(call) {
  return call?.ata || call?.atp || call?.atd || null;
}

/**
 * A junction between two calls is timed from the departure behind it to the
 * arrival ahead of it. Using the departure ahead pulls an approach junction
 * past the station it is running into.
 */
function guessBetween(before, after, t) {
  const fraction = Number.isFinite(t) ? t : 0.5;
  const from = leaveClock(before);
  const to = arriveClock(after);
  const wtp = notBefore(interpolateClock(from, to, fraction), from);
  const left = reportedLeave(before);
  const right = reportedArrive(after);
  const passed = Boolean(left && right);
  const live = interpolateClock(left, right, fraction);
  return { wtp, atp: passed ? live : null, etp: passed ? null : wtp };
}

/**
 * A junction the timetable omitted, when other trains leave the previous
 * stop through it and it sits on the way to the next call.
 */
export function insertSegmentJunctions(calls, sequences, coords, junctions = []) {
  const spine = (calls || []).filter((c) => c?.tiploc).map((c) => ({ ...c }));
  if (spine.length < 2) return spine;
  const map = coords instanceof Map ? new Map(coords) : new Map();
  for (const junction of junctions || []) {
    const key = String(junction?.tiploc || "").toUpperCase();
    if (!key || junction.e == null || junction.n == null || map.has(key)) continue;
    map.set(key, { e: Number(junction.e), n: Number(junction.n) });
  }
  const locate = (tpl) => map.get(String(tpl || "").toUpperCase());
  const nextOf = new Map();
  for (const seq of sequences || []) {
    for (let i = 0; i < seq.length - 1; i++) {
      const from = seq[i];
      const to = seq[i + 1];
      if (!from || !to || from === to || isSignalOrElocTiploc(to)) continue;
      let tally = nextOf.get(from);
      if (!tally) {
        tally = new Map();
        nextOf.set(from, tally);
      }
      tally.set(to, (tally.get(to) || 0) + 1);
    }
  }
  const present = new Set(spine.map((c) => String(c.tiploc).toUpperCase()));
  const stanoxOf = new Map();
  for (const junction of junctions || []) {
    const key = String(junction?.tiploc || "").toUpperCase();
    if (key && junction.stanox) stanoxOf.set(key, String(junction.stanox));
  }
  const presentStanox = new Set();
  for (const tiploc of present) {
    const stanox = stanoxOf.get(tiploc);
    if (stanox) presentStanox.add(stanox);
  }
  // Places the timetable actually joins. A junction beside a booked junction,
  // sharing the same onward places, is the other route out of this stop.
  const beside = new Map();
  const tie = (a, b) => {
    if (!a || !b || a === b) return;
    if (!beside.has(a)) beside.set(a, new Set());
    if (!beside.has(b)) beside.set(b, new Set());
    beside.get(a).add(b);
    beside.get(b).add(a);
  };
  for (const seq of sequences || []) {
    for (let i = 0; i < seq.length - 1; i++) tie(seq[i], seq[i + 1]);
  }
  const bookedJunction = new Set(
    (junctions || []).map((junction) => String(junction?.tiploc || "").toUpperCase()).filter(Boolean),
  );
  const parallelToBookedJunction = (candidate, prev, here) => {
    if (!beside.get(prev)?.has(here)) return false;
    const neighbours = beside.get(candidate);
    if (!neighbours) return false;
    return [prev, here].some((end) => {
      if (!bookedJunction.has(end) || neighbours.has(end)) return false;
      const onward = beside.get(end);
      if (!onward) return false;
      for (const place of neighbours) {
        if (place === prev || place === here) continue;
        if (onward.has(place)) return true;
      }
      return false;
    });
  };
  const out = [];
  for (let i = 0; i < spine.length; i++) {
    if (i > 0) {
      const prev = String(spine[i - 1].tiploc).toUpperCase();
      const here = String(spine[i].tiploc).toUpperCase();
      const candidates = [];
      const seen = new Set();
      const consider = (tpl) => {
        const key = String(tpl || "").toUpperCase();
        if (!key || key === here || present.has(key) || seen.has(key)) return;
        const point = locate(key);
        const t = onSegment(locate(prev), locate(here), point);
        if (t == null) return;
        // Ardwick station sits on Ardwick Junction. Other trains time the
        // platforms; this one has already booked the junction.
        if (point && [...present].some((existing) => {
          const placed = locate(existing);
          return placed && Math.hypot(placed.e - point.e, placed.n - point.n) < 400;
        })) return;
        seen.add(key);
        candidates.push({ tpl: key, t });
      };
      for (const [tpl, count] of nextOf.get(prev) || []) {
        if (count < 3) continue;
        consider(tpl);
      }
      for (const junction of junctions || []) {
        const key = String(junction?.tiploc || "").toUpperCase();
        const stanox = key ? stanoxOf.get(key) : "";
        if (stanox && presentStanox.has(stanox)) continue;
        if (parallelToBookedJunction(key, prev, here)) continue;
        const t = onSegment(locate(prev), locate(here), locate(key), 280);
        if (t == null || !key || key === here || present.has(key) || seen.has(key)) continue;
        seen.add(key);
        if (stanox) presentStanox.add(stanox);
        candidates.push({ tpl: key, t });
      }
      candidates.sort((a, b) => a.t - b.t);
      const before = spine[i - 1];
      const after = spine[i];
      candidates.forEach((candidate) => {
        present.add(candidate.tpl);
        const guess = guessBetween(before, after, candidate.t);
        out.push({
          tiploc: candidate.tpl,
          crs: null,
          is_passing: 1,
          cancelled: 0,
          platform: null,
          wta: null,
          wtd: null,
          wtp: guess.wtp,
          etp: guess.atp ? null : guess.etp,
          ata: null,
          atd: null,
          atp: guess.atp,
          live_kind: guess.atp ? "actual" : "est",
          actual_source: "inferred",
        });
      });
    }
    out.push(spine[i]);
  }
  return out.map((c, seq) => ({ ...c, seq }));
}

function chainageOf(chain, point) {
  let walked = 0;
  let best = Infinity;
  let at = 0;
  const consider = (chainage, distance) => {
    if (distance < best - 0.5) {
      best = distance;
      at = chainage;
    }
  };
  for (let index = 0; index < chain.length; index += 1) {
    const place = chain[index];
    if (index > 0) {
      const prev = chain[index - 1];
      const east = place.e - prev.e;
      const north = place.n - prev.n;
      const length = Math.hypot(east, north);
      if (length >= 1) {
        const t = ((point.e - prev.e) * east + (point.n - prev.n) * north) / (length * length);
        const clamped = Math.max(0, Math.min(1, t));
        consider(
          walked + clamped * length,
          Math.hypot(point.e - (prev.e + clamped * east), point.n - (prev.n + clamped * north)),
        );
        walked += length;
      }
    }
    consider(walked, Math.hypot(place.e - point.e, place.n - point.n));
  }
  return { at, away: best, length: walked };
}

/**
 * A passenger station the timetable left out, but only when every established
 * schedule between these two booked points passes it. The gap is the next
 * timing point already on this train, not the next station. Methley to
 * Altofts has a direct timing and a longer one through Castleford, so
 * Castleford is not added. A station is filled in only when there is no
 * timetable way from one booked point to the next without it.
 */
export function insertIntermediateStations(calls, sequences, stationCrs, locate) {
  const spine = (calls || []).filter((call) => call?.tiploc).map((call) => ({ ...call }));
  if (spine.length < 2 || !sequences?.length) return spine;
  const crsOf = (tiploc) => {
    const code = String(stationCrs?.(tiploc) || "").trim().toUpperCase();
    return code.length === 3 && !code.startsWith("X") ? code : "";
  };
  const pointOf = (tiploc) => locate?.(String(tiploc || "").toUpperCase()) || null;
  const present = new Set(spine.map((call) => String(call.tiploc).toUpperCase()));
  const anchorAt = spine.map(() => true);
  for (let left = 0; left < spine.length; left += 1) {
    if (!anchorAt[left]) continue;
    let right = left + 1;
    while (right < spine.length && !anchorAt[right]) right += 1;
    if (right >= spine.length) break;
    const from = String(spine[left].tiploc).toUpperCase();
    const to = String(spine[right].tiploc).toUpperCase();
    const booked = new Set();
    const chain = [];
    for (let index = left; index <= right; index += 1) {
      const tiploc = String(spine[index].tiploc).toUpperCase();
      if (index !== left && index !== right && !crsOf(tiploc)) booked.add(tiploc);
      const point = pointOf(tiploc);
      if (point) chain.push({ ...point, index });
    }
    if (chain.length < 2) continue;
    const paths = [];
    for (const seq of sequences || []) {
      const start = seq.indexOf(from);
      if (start < 0) continue;
      let end = -1;
      for (let index = start + 1; index < seq.length && index <= start + 12; index += 1) {
        if (seq[index] === to) {
          end = index;
          break;
        }
      }
      if (end < 0) continue;
      const mids = seq.slice(start + 1, end);
      const overlap = mids.filter((tiploc) => booked.has(tiploc)).length;
      paths.push({ mids, overlap });
    }
    const fitting = booked.size
      ? paths.filter((path) => path.overlap > 0 && path.overlap === Math.max(...paths.map((path) => path.overlap)))
      : paths;
    if (!fitting.length) continue;
    const patterns = new Map();
    fitting.forEach((path) => {
      const stations = path.mids.filter((tiploc) => crsOf(tiploc) && !present.has(tiploc) && !booked.has(tiploc));
      const key = stations.join(">");
      patterns.set(key, (patterns.get(key) || 0) + 1);
    });
    const established = [...patterns.entries()].filter(([, count]) => count >= 3);
    if (!established.length) continue;
    let required = null;
    for (const [key] of established) {
      const stations = new Set(key ? key.split(">") : []);
      required = required
        ? new Set([...required].filter((tiploc) => stations.has(tiploc)))
        : stations;
    }
    const found = [];
    for (const tiploc of required || []) {
      const point = pointOf(tiploc);
      if (!point) continue;
      const place = chainageOf(chain, point);
      if (place.away > 8000 || place.length <= 0) continue;
      found.push({ tiploc, crs: crsOf(tiploc), along: place.at / place.length });
    }
    found.sort((a, b) => a.along - b.along);
    let inserted = 0;
    found.forEach((station) => {
      let at = right + inserted;
      for (let index = left + 1; index < right + inserted; index += 1) {
        const point = pointOf(spine[index].tiploc);
        if (!point) continue;
        const place = chainageOf(chain, point);
        if (place.length > 0 && place.at / place.length > station.along) {
          at = index;
          break;
        }
      }
      const before = spine[at - 1];
      const after = spine[at];
      const guess = guessBetween(before, after, 0.5);
      present.add(station.tiploc);
      spine.splice(at, 0, {
        tiploc: station.tiploc,
        crs: station.crs,
        is_passing: 1,
        cancelled: 0,
        platform: null,
        wta: null,
        wtd: null,
        wtp: guess.wtp,
        etp: guess.atp ? null : guess.etp,
        ata: null,
        atd: null,
        atp: guess.atp,
        live_kind: guess.atp ? "actual" : "est",
        actual_source: "inferred",
      });
      inserted += 1;
      anchorAt.splice(at, 0, false);
    });
    left = right + inserted - 1;
  }
  return spine.map((call, seq) => ({ ...call, seq }));
}

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
      const t0 = leaveClock(spine[i - 1]);
      const t1 = arriveClock(spine[i]);
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

function stanoxByTiploc(catalog, tiplocs) {
  const map = new Map();
  if (!catalog) return map;
  let stmt;
  try {
    stmt = catalog.prepare(`SELECT stanox FROM corpus WHERE tiploc = ? COLLATE NOCASE`);
  } catch {
    return map;
  }
  for (const tiploc of tiplocs || []) {
    const key = String(tiploc || "").toUpperCase();
    if (!key || map.has(key)) continue;
    const row = stmt.get(key);
    const stanox = String(row?.stanox || "").trim();
    if (stanox) map.set(key, stanox);
  }
  return map;
}

/**
 * Two TIPLOCs can name one junction. A report for the other spelling updates
 * the place already on this train instead of adding a second row.
 */
export function reportsOnServiceTiploc(calls, reports, stanoxOf) {
  const present = [];
  for (const call of calls || []) {
    const tiploc = String(call?.tiploc || "").toUpperCase();
    if (tiploc && !present.includes(tiploc)) present.push(tiploc);
  }
  const onService = new Set(present);
  const stanoxToCall = new Map();
  for (const tiploc of present) {
    const stanox = stanoxOf?.(tiploc);
    if (stanox && !stanoxToCall.has(stanox)) stanoxToCall.set(stanox, tiploc);
  }
  return (reports || []).map((report) => {
    const tiploc = String(report?.tiploc || "").toUpperCase();
    if (!tiploc || onService.has(tiploc)) return { ...report, tiploc };
    const existing = stanoxToCall.get(stanoxOf?.(tiploc));
    return { ...report, tiploc: existing || tiploc };
  });
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
  for (const [tiploc, ev] of byTpl) {
    const index = nearestBookedVisitIndex(rows, tiploc, ev.actual);
    if (index < 0 || !ev?.actual) continue;
    const call = rows[index];
    if (call.atp || call.atd || call.ata) continue;
    const kind = String(ev.event_type || "").toUpperCase();
    if (Number(call.is_passing) || kind === "PASS") {
      call.atp = ev.actual;
      call.live_kind = "actual";
      call.actual_source = "trust";
    }
  }
  const reported = rows
    .map((call, index) => ({ index, booked: callBookedMin(call), actual: callActualMin(call) }))
    .filter(
      (row) =>
        row.actual != null &&
        row.booked != null &&
        actualBelongsToBooked(row.booked, row.actual),
    );
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

function shownMinute(call) {
  return hmToMin(call?.atd || call?.ata || call?.etd || call?.atp || call?.etp || call?.eta);
}

function isRealActual(call) {
  if (String(call?.actual_source || "") === "inferred") return false;
  return Boolean(call?.atd || call?.ata || call?.atp);
}

function runningLateness(call) {
  const pairs = [
    [call.atd, call.wtd || call.ptd],
    [call.ata, call.wta || call.pta],
    [call.atp, call.wtp || call.wtd || call.wta],
  ];
  for (const [live, booked] of pairs) {
    const l = hmToMin(live);
    const b = hmToMin(booked);
    if (l == null || b == null) continue;
    return unwrapMinute(l, b) - b;
  }
  return null;
}

function softerThan(call, late) {
  const booked = hmToMin(call.wtd || call.ptd || call.wta || call.pta || call.wtp);
  const shown = shownMinute(call);
  if (booked == null) return false;
  if (shown == null) return true;
  return unwrapMinute(shown, booked) - booked < late;
}

function writeCarried(call, late) {
  if (
    String(call.actual_source || "") === "inferred" &&
    (call.atp || call.ata || call.atd) &&
    callBookedMin(call) != null
  ) return;
  let wrote = false;
  for (const [key, booked] of [
    ["etd", call.wtd || call.ptd],
    ["eta", call.wta || call.pta],
    ["etp", call.wtp],
  ]) {
    const base = hmToMin(booked);
    if (base == null) continue;
    call[key] = minToHm(base + late);
    wrote = true;
  }
  if (!wrote) return;
  if (String(call.actual_source || "") === "inferred") {
    call.atp = null;
    call.ata = null;
    call.atd = null;
  }
  call.live_kind = "est";
}

function setShownMinute(call, minute) {
  const clock = minToHm(minute);
  if (call.etd) call.etd = clock;
  else if (call.eta && !call.wtd && !call.ptd) call.eta = clock;
  else if (call.etp || call.wtp || String(call.actual_source || "") === "inferred") {
    call.etp = clock;
    if (String(call.actual_source || "") === "inferred") call.atp = null;
  } else call.etp = clock;
  call.live_kind = call.live_kind === "actual" || call.live_kind === "actual-arr" ? "est" : call.live_kind || "est";
}

/**
 * A later public call often still carries the booked time, so a train that is
 * late snaps back to right time and the next estimate can be earlier than the
 * one before it. Hold the last real lateness, and keep an estimate inside the
 * reports on either side.
 */
export function carryRunningLateness(calls) {
  const rows = (calls || []).map((c) => ({ ...c }));
  let late = null;
  for (const call of rows) {
    if (!isRealActual(call)) {
      if (late != null && softerThan(call, late)) writeCarried(call, late);
      continue;
    }
    const found = runningLateness(call);
    if (found != null) late = found;
  }
  const origin = rows.map(shownMinute).find((minute) => minute != null);
  if (origin == null) return rows;
  let prev = null;
  for (let i = 0; i < rows.length; i++) {
    const call = rows[i];
    const minute = shownMinute(call);
    if (minute == null) continue;
    const shown = unwrapMinute(minute, origin);
    if (
      String(call.actual_source || "") === "inferred" &&
      (call.atp || call.ata || call.atd) &&
      callBookedMin(call) != null
    ) {
      if (prev == null || shown >= prev) prev = shown;
      continue;
    }
    if (isRealActual(call)) {
      if (prev == null || shown >= prev) prev = shown;
      continue;
    }
    let next = null;
    for (let j = i + 1; j < rows.length; j++) {
      if (!isRealActual(rows[j])) continue;
      const ahead = shownMinute(rows[j]);
      if (ahead != null) next = unwrapMinute(ahead, origin);
      break;
    }
    let placed = shown;
    if (prev != null && placed < prev) placed = prev;
    if (next != null && placed >= next) placed = Math.max(prev ?? next - 1, next - 1);
    if (placed !== shown) setShownMinute(call, placed);
    prev = placed;
  }
  return rows;
}

/**
 * An inferred pass with only an interpolated clock is not a report. Once a
 * later call has a real time, drop that estimate so the row is not left on
 * "Expected at".
 */
export function settleUnreportedPasses(calls) {
  const rows = (calls || []).map((c) => ({ ...c }));
  let lastReal = -1;
  rows.forEach((call, index) => {
    if (isRealActual(call)) lastReal = index;
  });
  if (lastReal < 0) return rows;
  for (let i = 0; i < lastReal; i++) {
    const call = rows[i];
    if (String(call.actual_source || "") !== "inferred") continue;
    if (call.atp || call.atd || call.ata) continue;
    // No booked time: the clock is only an estimate, so it is not cleared into "No report".
    if (callBookedMin(call) == null && call.etp) continue;
    call.etp = null;
    call.etd = null;
    call.eta = null;
    call.live_kind = null;
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
    if (row.tiploc || isSignallingBerth(row.berth)) continue;
    const mapped = resolveSmartTiploc(catalog, row.area_id, row.berth, row.from_berth, {
      hintTiplocs: hints,
    });
    const tpl = mapped?.tiploc ? String(mapped.tiploc).toUpperCase() : "";
    if (!tpl || byTpl.has(tpl)) continue;
    byTpl.set(tpl, row);
  }
  const rows = [...byTpl.entries()].map(([tiploc, row]) => ({ tiploc, row }));
  const stanoxOf = stanoxByTiploc(catalog, [
    ...hints,
    ...rows.map((item) => item.tiploc),
  ]);
  const aliased = reportsOnServiceTiploc(calls, rows, (tiploc) => stanoxOf.get(tiploc));
  const out = new Map();
  for (const item of aliased) {
    const prev = out.get(item.tiploc);
    if (!prev || Number(item.row?.received_at || 0) >= Number(prev.received_at || 0)) out.set(item.tiploc, item.row);
  }
  return out;
}

function callMinute(call) {
  return hmToMin(call?.atp || call?.atd || call?.ata || call?.etp || call?.etd || call?.eta || call?.wtp || call?.wtd || call?.wta);
}

function unwrapMinute(minute, origin) {
  let delta = minute - origin;
  if (delta < -12 * 60) delta += 1440;
  else if (delta > 12 * 60) delta -= 1440;
  return origin + delta;
}

function timedCalls(calls) {
  const seed = (calls || []).map(callMinute).find((minute) => minute != null);
  if (seed == null) return [];
  return (calls || [])
    .map((call, index) => {
      const minute = callMinute(call);
      if (minute == null) return null;
      return {
        index,
        minute: unwrapMinute(minute, seed),
        tiploc: String(call.tiploc || "").toUpperCase(),
      };
    })
    .filter(Boolean);
}

/** A place off to one side of the calls either side of it, in metres. */
const CHORD_EXTRA_M = 2000;

/**
 * A booked pass whose grid is not on the way between the stops either side.
 * Mill Lane Junction is timed between Low Moor and Bradford, but the stored
 * pin is west of Halifax, so the calling list was showing a junction this
 * train does not pass there. A pass on the chord, and every passenger call, stays.
 */
export function dropPassesOffTheLeg(calls, coords, slack = CHORD_EXTRA_M) {
  const locate = coords instanceof Map ? coords : new Map();
  const rows = calls || [];
  const place = (call) => locate.get(String(call?.tiploc || "").toUpperCase());
  const passenger = (call) => {
    const crs = String(call?.crs || "").trim().toUpperCase();
    return crs.length === 3 && !crs.startsWith("X");
  };
  return rows
    .filter((call, index) => {
      if (!Number(call?.is_passing) || passenger(call)) return true;
      const here = place(call);
      if (!here) return true;
      let prev = null;
      for (let i = index - 1; i >= 0; i -= 1) {
        const found = place(rows[i]);
        if (found) {
          prev = found;
          break;
        }
      }
      let next = null;
      for (let i = index + 1; i < rows.length; i += 1) {
        const found = place(rows[i]);
        if (found) {
          next = found;
          break;
        }
      }
      if (!prev || !next) return true;
      const direct = Math.hypot(prev.e - next.e, prev.n - next.n);
      const via = Math.hypot(prev.e - here.e, prev.n - here.n) + Math.hypot(here.e - next.e, here.n - next.n);
      return via - direct <= slack;
    })
    .map((call, seq) => ({ ...call, seq }));
}

/**
 * TRUST and TD rows for this headcode also match other trains that reused it.
 * Keep a row only when its clock is between this train's calls and, where we
 * have coordinates, it sits on the straight line between those calls.
 */
export function reportsForService(calls, reports, coords = null) {
  const timed = timedCalls(calls);
  if (!timed.length) return [];
  const start = Math.min(...timed.map((row) => row.minute));
  const end = Math.max(...timed.map((row) => row.minute));
  const locate = coords instanceof Map ? coords : null;
  return (reports || []).filter((report) => {
    if (report.minute == null) return false;
    const minute = unwrapMinute(report.minute, start);
    if (minute < start || minute > end) return false;
    if (!locate) return true;
    const here = locate.get(String(report.tiploc || "").toUpperCase());
    if (!here) return true;
    const prev = [...timed].reverse().find((row) => row.minute <= minute && locate.has(row.tiploc));
    const next = timed.find((row) => row.index > (prev?.index ?? -1) && row.minute >= minute && locate.has(row.tiploc));
    if (!prev || !next) return false;
    const a = locate.get(prev.tiploc);
    const b = locate.get(next.tiploc);
    const direct = Math.hypot(a.e - b.e, a.n - b.n);
    const via = Math.hypot(a.e - here.e, a.n - here.n) + Math.hypot(here.e - b.e, here.n - b.n);
    return via - direct <= CHORD_EXTRA_M;
  });
}

let stationCrsCache = null;

/** TIPLOC to CRS for passenger stations. Sidings and X-codes are left out. */
export function passengerStationCrs(catalog) {
  if (stationCrsCache) return stationCrsCache;
  const map = new Map();
  if (catalog) {
    try {
      const rows = catalog
        .prepare(`SELECT tiploc, crs FROM corpus WHERE crs IS NOT NULL AND trim(crs) != ''`)
        .all();
      for (const row of rows) {
        const crs = String(row.crs || "").trim().toUpperCase();
        if (crs.length !== 3 || crs.startsWith("X")) continue;
        map.set(String(row.tiploc).toUpperCase(), crs);
      }
    } catch {
      /* The catalogue has no corpus table in this process. */
    }
  }
  stationCrsCache = map;
  return map;
}

let namedJunctionCache = null;

/** Junctions with a grid position. Sidings and depots are left out. */
export function namedJunctionPoints(catalog) {
  if (namedJunctionCache) return namedJunctionCache;
  if (!catalog) return [];
  try {
    const rows = catalog
      .prepare(
        `SELECT c.tiploc AS tiploc, c.name AS name, c.crs AS crs, c.stanox AS stanox,
                g.easting AS e, g.northing AS n
         FROM corpus c
         JOIN tiploc_geo g ON g.tiploc = c.tiploc
         WHERE c.name LIKE '%Junction%' AND g.easting IS NOT NULL AND g.northing IS NOT NULL`,
      )
      .all();
    namedJunctionCache = rows
      .filter((row) => row.e != null && row.n != null && !isNonPassengerLocation(row.tiploc, { name: row.name, crs: row.crs }))
      .map((row) => ({
        tiploc: String(row.tiploc).toUpperCase(),
        e: Number(row.e),
        n: Number(row.n),
        stanox: String(row.stanox || "").trim(),
      }));
  } catch {
    namedJunctionCache = [];
  }
  return namedJunctionCache;
}

export function tiplocCoords(catalog, tiplocs) {
  const map = new Map();
  if (!catalog) return map;
  let stmt;
  try {
    stmt = catalog.prepare(`SELECT easting AS e, northing AS n FROM tiploc_geo WHERE tiploc = ?`);
  } catch {
    return map;
  }
  for (const tiploc of tiplocs || []) {
    const key = String(tiploc || "").toUpperCase();
    if (!key || map.has(key)) continue;
    const row = stmt.get(key);
    if (row?.e == null || row?.n == null) continue;
    map.set(key, { e: Number(row.e), n: Number(row.n) });
  }
  return map;
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
    if (report.source === "td" && !String(report.name || "").trim()) continue;
    if (isNonPassengerLocation(tiploc, { name: report.name, crs: report.crs })) continue;
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
      if (isNonPassengerLocation(tiploc, meta)) continue;
      byTpl.set(tiploc, { tiploc, crs: meta.crs || null, name: meta.name || "", clock, minute, source: "trust" });
    }
  }
  for (const [tiploc, row] of tdByTiploc(db, headcode, catalog, calls)) {
    const clock = actualFromTdEvent(row);
    const minute = hmToMin(clock);
    if (!tiploc || minute == null) continue;
    const meta = corpusMeta(catalog, tiploc);
    if (isNonPassengerLocation(tiploc, meta)) continue;
    byTpl.set(tiploc, { tiploc, crs: meta.crs || null, name: meta.name || "", clock, minute, source: "td" });
  }
  const reports = [...byTpl.values()];
  const stanoxOf = stanoxByTiploc(catalog, [
    ...(calls || []).map((call) => call.tiploc),
    ...reports.map((report) => report.tiploc),
  ]);
  return reportsOnServiceTiploc(calls, reports, (tiploc) => stanoxOf.get(tiploc));
}

export function overlayTdOnCalls(db, calls, headcode, catalog = null) {
  const byTpl = tdByTiploc(db, headcode, catalog, calls);
  if (!byTpl.size) return calls || [];
  const rows = (calls || []).map((c) => ({ ...c }));
  for (const [tiploc, ev] of byTpl) {
    const actual = actualFromTdEvent(ev);
    if (!actual) continue;
    const minute = hmToMin(actual);
    let target = -1;
    let best = Infinity;
    rows.forEach((call, index) => {
      if (String(call.tiploc || "").toUpperCase() !== tiploc) return;
      const booked = hmToMin(call.wtp || call.wtd || call.wta || call.atp || call.atd || call.ata);
      let delta = booked == null || minute == null ? 0 : Math.abs(booked - minute);
      if (delta > 12 * 60) delta = 1440 - delta;
      if (delta < best) {
        best = delta;
        target = index;
      }
    });
    if (target < 0) continue;
    const call = rows[target];
    const schedule = hmToMin(call.wtp || call.wtd || call.wta || call.std || call.sta);
    if (schedule != null && minute != null && !actualBelongsToBooked(schedule, minute)) continue;
    if (call.ata || call.atd || call.atp) rows[target] = withTdSeconds(call, actual);
    else if (Number(call.is_passing)) {
      rows[target] = { ...call, atp: actual, live_kind: "actual", actual_source: call.actual_source || "td" };
    }
  }
  return rows;
}
