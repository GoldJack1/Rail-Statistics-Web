import { addCalendarDays } from "./calendar-day.js";

/** CIF BS date-run fields (1-based 10–28). */

/** Cap so a nightly CIF import cannot unbounded-grow. Darwin’s own day is never filled from CIF. */
export const MAX_TT_AHEAD_DAYS = 28;
export const DEFAULT_TT_AHEAD_DAYS = 14;
export const TT_IMPORT_BATCH_DAYS = 14;

export function longRangeAheadDays(raw = process.env.TT_CIF_AHEAD_DAYS) {
  const n = Number(raw ?? DEFAULT_TT_AHEAD_DAYS);
  if (!Number.isFinite(n)) return DEFAULT_TT_AHEAD_DAYS;
  return Math.min(MAX_TT_AHEAD_DAYS, Math.max(0, Math.trunc(n)));
}

/** Calendar days to fill from CIF/DTD, excluding Darwin’s current operating day. */
export function cifImportDayYmds(startYmd, ahead, skipYmd) {
  const days = [];
  const n = Math.max(0, Math.trunc(Number(ahead) || 0));
  for (let i = 0; i <= n; i++) {
    const ymd = addCalendarDays(startYmd, i);
    if (skipYmd && ymd === skipYmd) continue;
    days.push(ymd);
  }
  return days;
}

export function parseCifTime(raw) {
  const t = String(raw || "").replace(/\s/g, "").toUpperCase();
  if (t.length < 4 || !/^\d{4}/.test(t)) return null;
  const hm = `${t.slice(0, 2)}:${t.slice(2, 4)}`;
  if (t.length >= 5 && t[4] === "H") return `${hm}½`;
  return hm;
}

/** Public CIF 0000 is padding, not a midnight passenger time. */
export function parseCifPublicTime(raw) {
  const t = String(raw || "").replace(/\s/g, "");
  if (t === "0000") return null;
  return parseCifTime(raw);
}

/** BX positions 12–13 (1-based) = ATOC code. */
export function parseCifBxAtoc(line) {
  if (!line || line.slice(0, 2) !== "BX") return null;
  const toc = line.slice(11, 13).trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(toc) ? toc : null;
}

function numericSpeed(raw) {
  const text = String(raw || "").trim();
  return /^\d{2,3}$/.test(text) ? String(Number(text)) : null;
}

/** CIF BS power type (47–49), timing load (50–53), speed (54–57), 1-based. */
export function parseCifBsStock(line) {
  if (!line || line.slice(0, 2) !== "BS") return { powerType: null, timingLoad: null, speed: null };
  const rawPower = line.slice(46, 49).trim().toUpperCase();
  const rawLoad = line.slice(49, 53).trim().toUpperCase();
  const speed = line.slice(53, 57).trim().toUpperCase();
  const knownPower = /^(EMU|DMU|DEM|HST|ED|E|D)$/;
  let powerType = rawPower && rawPower !== "000" ? rawPower : null;
  let timingLoad = rawLoad || null;
  let mph = numericSpeed(line.slice(57, 60));
  if (!powerType && knownPower.test(rawLoad)) {
    powerType = rawLoad;
    timingLoad = /^\d+$/.test(speed) ? speed : null;
  } else if (!mph) {
    mph = numericSpeed(speed);
  }
  return { powerType, timingLoad, speed: mph };
}

/** CIF BS identity fields that sit beside the stock codes. */
export function parseCifBsProfile(line) {
  if (!line || line.slice(0, 2) !== "BS") return null;
  const stock = parseCifBsStock(line);
  return {
    runsFrom: cifYymmdd(line.slice(9, 15)),
    runsTo: cifYymmdd(line.slice(15, 21)),
    daysRun: line.slice(21, 28),
    bankHoliday: line.slice(28, 29).trim().toUpperCase() || null,
    trainStatus: line.slice(29, 30).trim().toUpperCase() || null,
    category: line.slice(30, 32).trim().toUpperCase() || null,
    identity: line.slice(32, 36).trim().toUpperCase() || null,
    headcode: line.slice(36, 40).trim().toUpperCase() || null,
    tsc: line.slice(41, 49).trim().toUpperCase() || null,
    speed: stock.speed,
    operating: line.slice(60, 66).trim().toUpperCase() || null,
    seating: line.slice(66, 67).trim().toUpperCase() || null,
    reservations: line.slice(68, 69).trim().toUpperCase() || null,
  };
}

/**
 * CIF location field is 7-character TIPLOC plus a 1-character instance.
 * A second pass over the same junction is LEEDSWJ + "2", not a different place.
 */
export function cifLocationIdentity(line) {
  const field = String(line || "").slice(2, 10).toUpperCase();
  const tiploc = field.slice(0, 7).trim();
  const suffix = field.slice(7, 8).trim() || null;
  return { tiploc, suffix };
}

/** CIF CR: timing load, power or speed changes from this location. */
export function parseCifChange(line) {
  if (!line || line.slice(0, 2) !== "CR") return null;
  const { tiploc } = cifLocationIdentity(line);
  if (!tiploc) return null;
  const power = line.slice(30, 33).trim().toUpperCase();
  const load = line.slice(33, 37).trim().toUpperCase();
  return {
    tiploc,
    powerType: power && power !== "000" ? power : null,
    timingLoad: load || null,
    speed: numericSpeed(line.slice(37, 40)),
  };
}

function cifField(line, from, to) {
  return String(line || "")
    .slice(from, to)
    .trim()
    .toUpperCase() || null;
}

function cifAllowance(line, from) {
  const raw = cifField(line, from, from + 2);
  if (!raw || raw === "00") return null;
  return raw;
}

/**
 * LO / LI / LT calling-point times, platform, line and path (CIF End User spec).
 * Public times are 4 characters; working times are 5 (H = half-minute).
 */
export function parseCifLocation(rec, line) {
  const { tiploc, suffix } = cifLocationIdentity(line);
  if (!tiploc) return null;
  if (rec === "LO") {
    const wtd = parseCifTime(line.slice(10, 15));
    const ptd = parseCifPublicTime(line.slice(15, 19));
    return {
      tiploc,
      suffix,
      wta: null,
      wtd,
      wtp: null,
      pta: null,
      ptd,
      platform: cifField(line, 19, 22),
      line: cifField(line, 22, 25),
      path: null,
      engineeringAllowance: cifAllowance(line, 25),
      pathingAllowance: cifAllowance(line, 27),
      performanceAllowance: cifAllowance(line, 29),
      passing: false,
    };
  }
  if (rec === "LT") {
    const wta = parseCifTime(line.slice(10, 15));
    const pta = parseCifPublicTime(line.slice(15, 19));
    return {
      tiploc,
      suffix,
      wta,
      wtd: null,
      wtp: null,
      pta,
      ptd: null,
      platform: cifField(line, 19, 22),
      line: null,
      path: cifField(line, 22, 25),
      engineeringAllowance: null,
      pathingAllowance: null,
      performanceAllowance: null,
      passing: false,
    };
  }
  const wta = parseCifTime(line.slice(10, 15));
  const wtd = parseCifTime(line.slice(15, 20));
  const wtp = parseCifTime(line.slice(20, 25));
  const pta = parseCifPublicTime(line.slice(25, 29));
  const ptd = parseCifPublicTime(line.slice(29, 33));
  const act = line.slice(41, 43).trim().toUpperCase();
  const passing = act === "T" || Boolean(wtp && !wta && !wtd && !pta && !ptd);
  return {
    tiploc,
    suffix,
    wta,
    wtd,
    wtp,
    pta,
    ptd,
    platform: cifField(line, 33, 36),
    line: cifField(line, 36, 39),
    path: cifField(line, 39, 42),
    engineeringAllowance: cifAllowance(line, 44),
    pathingAllowance: cifAllowance(line, 46),
    performanceAllowance: cifAllowance(line, 48),
    passing,
  };
}

export function cifYymmdd(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 6) return null;
  const yy = Number(s.slice(0, 2));
  const year = yy >= 60 ? 1900 + yy : 2000 + yy;
  return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

export function cifWeekdayIndex(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

export function cifBsRunsOn(line, ymd) {
  if (!line || line.slice(0, 2) !== "BS" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return false;
  const txn = line.slice(2, 3).toUpperCase();
  if (txn === "D") return false;
  const stp = (line[79] || "").toUpperCase();
  if (stp === "C") return false;
  const start = cifYymmdd(line.slice(9, 15));
  const end = cifYymmdd(line.slice(15, 21));
  const days = line.slice(21, 28);
  if (start && ymd < start) return false;
  if (end && ymd > end) return false;
  if (days.length >= 7 && days[cifWeekdayIndex(ymd)] === "0") return false;
  return true;
}

/** CIF STP indicator (column 80): overlay/new beat the permanent booked path. */
export function cifStpRank(line) {
  const stp = String(line?.[79] || "").toUpperCase();
  if (stp === "O") return 3;
  if (stp === "N") return 2;
  if (stp === "P") return 1;
  return 0;
}

function cifTpl(loc) {
  return String(loc?.tiploc || "").trim().toUpperCase();
}

/** CIF/JSON store 0000 in the public fields of a working pass. That is not a call. */
function cifPublicTime(value) {
  if (value == null || value === "") return null;
  const hm = String(value).trim().slice(0, 5);
  if (hm === "00:00" || hm === "0000") return null;
  return String(value).trim();
}

function cifLocIsPublic(loc) {
  return Boolean(cifPublicTime(loc?.pta) || cifPublicTime(loc?.ptd));
}

function cifPassRow(loc) {
  const pta = cifPublicTime(loc.pta);
  const ptd = cifPublicTime(loc.ptd);
  const passing = Boolean(loc.passing) || Boolean(loc.wtp && !loc.wta && !loc.wtd && !pta && !ptd);
  return {
    tiploc: cifTpl(loc),
    crs: loc.crs ?? null,
    is_passing: passing ? 1 : 0,
    cancelled: 0,
    platform: loc.platform ?? null,
    line: loc.line ?? null,
    path: loc.path ?? null,
    sta: pta,
    std: ptd,
    wta: loc.wta ?? null,
    wtd: loc.wtd ?? null,
    wtp: passing ? loc.wtp || loc.wtd || null : loc.wtp ?? null,
    live_kind: "scheduled",
    actual_source: null,
    cifPass: true,
  };
}

function findCifTpl(cif, tpl, from) {
  const u = String(tpl || "").toUpperCase();
  for (let i = from; i < cif.length; i++) {
    if (cifTpl(cif[i]) === u) return i;
  }
  return -1;
}

function darwinAdvertised(c) {
  if (Number(c?.is_passing)) return false;
  const sta = c?.sta && String(c.sta).slice(0, 5) !== "00:00";
  const std = c?.std && String(c.std).slice(0, 5) !== "00:00";
  return Boolean(sta || std);
}

/** Public times / live actuals / booked stops — not invented working passes. */
export function darwinScheduleAnchors(calls) {
  const rows = (calls || []).filter((c) => cifTpl(c));
  const anchors = rows.filter((c) => {
    if (c?.ata || c?.atd || c?.atp) return true;
    const sta = c?.sta && String(c.sta).slice(0, 5) !== "00:00";
    const std = c?.std && String(c.std).slice(0, 5) !== "00:00";
    if (sta || std) return true;
    if (!Number(c?.is_passing)) return true;
    const crs = String(c?.crs || "").trim().toUpperCase();
    if (crs.length === 3 && !crs.startsWith("X")) return true;
    return false;
  });
  return anchors.length >= 2 ? anchors : rows;
}

function callClock(c) {
  const raw = c?.wtp || c?.wtd || c?.wta || c?.std || c?.sta || c?.ptd || c?.pta;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesApart(a, b) {
  const am = callClock(a);
  const bm = callClock(b);
  if (am == null || bm == null) return null;
  let d = Math.abs(am - bm);
  if (d > 720) d = 1440 - d;
  return d;
}

/** Same TIPLOC and the same booked clock. A later diversion pass is a different visit. */
function sameVisit(row, loc) {
  if (cifTpl(row) !== cifTpl(loc)) return false;
  const apart = minutesApart(row, loc);
  return apart == null || apart === 0;
}

/** True when CIF is the same working as Darwin (no extra public stops such as Huddersfield). */
export function cifMatchesDarwinPublicPath(darwinCalls, cifLocs) {
  const darwin = (darwinCalls || []).filter((c) => cifTpl(c));
  const cif = (cifLocs || []).filter((c) => cifTpl(c));
  if (!darwin.length || !cif.length) return false;
  const darwinSet = new Set(darwin.map((c) => cifTpl(c)));
  if (cif.some((loc) => cifLocIsPublic(loc) && !darwinSet.has(cifTpl(loc)))) return false;
  let from = 0;
  for (const c of darwin) {
    if (!darwinAdvertised(c)) continue;
    const i = findCifTpl(cif, c.tiploc, from);
    if (i < 0) return false;
    from = i + 1;
  }
  return true;
}

function stampWorkingFromCif(d, loc) {
  if (!d) return cifPassRow(loc);
  if (!loc) return d;
  const wtp = loc.wtp != null ? loc.wtp : loc.wta || loc.wtd ? null : (d.wtp ?? null);
  return {
    ...d,
    wta: loc.wta ?? d.wta ?? null,
    wtd: loc.wtd ?? d.wtd ?? null,
    wtp,
    path: loc.path ?? d.path ?? null,
    line: loc.line ?? d.line ?? null,
    platform: d.platform || loc.platform || null,
  };
}

function mergeFullCifWtt(darwin, cif) {
  const unused = darwin.slice();
  const counts = new Map();
  for (const loc of cif) counts.set(cifTpl(loc), (counts.get(cifTpl(loc)) || 0) + 1);
  const out = [];
  for (const loc of cif) {
    const tpl = cifTpl(loc);
    let best = -1;
    let bestDelta = Infinity;
    unused.forEach((call, index) => {
      if (cifTpl(call) !== tpl) return;
      const delta = minutesApart(call, loc);
      const score = delta == null ? 1e9 : delta;
      if (score < bestDelta) {
        bestDelta = score;
        best = index;
      }
    });
    const unique = counts.get(tpl) === 1;
    if (best >= 0 && (unique || bestDelta <= 3)) {
      out.push(stampWorkingFromCif(unused[best], loc));
      unused.splice(best, 1);
    } else {
      out.push(cifPassRow(loc));
    }
  }
  for (const call of unused) {
    const mins = callClock(call);
    if (mins == null) continue;
    if (out.some((row) => sameVisit(row, call))) continue;
    let at = out.length;
    for (let i = 0; i < out.length; i++) {
      const om = callClock(out[i]);
      if (om != null && om > mins) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, call);
  }
  return out;
}

function mergeCifBetweenDarwinAnchors(darwin, cif) {
  const out = [];
  let cifFrom = 0;
  for (let i = 0; i < darwin.length; i++) {
    const iaHere = findCifTpl(cif, darwin[i].tiploc, 0);
    out.push(iaHere >= 0 ? stampWorkingFromCif(darwin[i], cif[iaHere]) : darwin[i]);
    if (i === darwin.length - 1) break;
    const ia = findCifTpl(cif, darwin[i].tiploc, cifFrom);
    if (ia < 0) continue;
    const ib = findCifTpl(cif, darwin[i + 1].tiploc, ia + 1);
    if (ib < 0) continue;
    const extras = cif.slice(ia + 1, ib);
    for (const loc of extras) {
      if (out.some((row) => sameVisit(row, loc))) continue;
      // Do not invent a Darwin-omitted public stop (Huddersfield diversion),
      // but still insert working passes in the same span (Huyton / Rainhill).
      if (cifLocIsPublic(loc)) continue;
      out.push(cifPassRow(loc));
    }
    const atCursor = cif[ia];
    if (atCursor && !cifLocIsPublic(atCursor) && !out.some((row) => sameVisit(row, atCursor))) {
      out.push(cifPassRow(atCursor));
    }
    cifFrom = ib;
  }
  return out;
}

/**
 * Prefer the full CIF working timetable when it is the same passenger path as Darwin
 * (RTT detailed). Otherwise only fill pass TIPLOCs between matching Darwin anchors.
 */
export function mergeDarwinCallsWithCifPasses(darwinCalls, cifLocs) {
  const darwin = (darwinCalls || []).filter((c) => cifTpl(c));
  const cif = (cifLocs || []).filter((c) => cifTpl(c));
  if (!darwin.length) return [];
  const merged = cifMatchesDarwinPublicPath(darwin, cif)
    ? mergeFullCifWtt(darwin, cif)
    : mergeCifBetweenDarwinAnchors(darwin, cif);
  return merged.map((c, seq) => ({ ...c, seq }));
}
