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
  const t = String(raw || "").replace(/\s/g, "");
  if (t.length < 4 || !/^\d{4}/.test(t)) return null;
  return `${t.slice(0, 2)}:${t.slice(2, 4)}`;
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

/**
 * LO / LI / LT calling-point times and platform (CIF End User spec).
 * Public times are 4 characters; working times are 5 (H=half-minute ignored).
 */
export function parseCifLocation(rec, line) {
  const tiploc = String(line || "")
    .slice(2, 10)
    .trim()
    .toUpperCase();
  if (rec === "LO") {
    const wtd = parseCifTime(line.slice(10, 15));
    const ptd = parseCifPublicTime(line.slice(15, 19));
    return {
      tiploc,
      wta: null,
      wtd,
      wtp: null,
      pta: null,
      ptd,
      platform: line.slice(19, 22).trim() || null,
      passing: false,
    };
  }
  if (rec === "LT") {
    const wta = parseCifTime(line.slice(10, 15));
    const pta = parseCifPublicTime(line.slice(15, 19));
    return {
      tiploc,
      wta,
      wtd: null,
      wtp: null,
      pta,
      ptd: null,
      platform: line.slice(19, 22).trim() || null,
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
    wta,
    wtd,
    wtp,
    pta,
    ptd,
    platform: line.slice(33, 36).trim() || null,
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

function cifLocIsPublic(loc) {
  return Boolean(loc?.pta || loc?.ptd);
}

function cifPassRow(loc) {
  const passing = Boolean(loc.passing) || Boolean(loc.wtp && !loc.wta && !loc.wtd && !loc.pta && !loc.ptd);
  return {
    tiploc: cifTpl(loc),
    crs: loc.crs ?? null,
    is_passing: passing ? 1 : 0,
    cancelled: 0,
    platform: loc.platform ?? null,
    sta: loc.pta ?? null,
    std: loc.ptd ?? null,
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

function mergeFullCifWtt(darwin, cif) {
  const byTpl = new Map();
  for (const c of darwin) byTpl.set(cifTpl(c), c);
  const used = new Set();
  const out = [];
  for (const loc of cif) {
    const tpl = cifTpl(loc);
    const d = byTpl.get(tpl);
    if (d) {
      // Keep Darwin live/public fields; prefer ITPS/CIF working times (fixes stale densify clocks).
      // When CIF has a stop arrival/departure, drop a leftover Darwin pass time.
      const wtp =
        loc.wtp != null ? loc.wtp : loc.wta || loc.wtd ? null : (d.wtp ?? null);
      out.push({
        ...d,
        wta: loc.wta ?? d.wta ?? null,
        wtd: loc.wtd ?? d.wtd ?? null,
        wtp,
      });
      used.add(tpl);
    } else {
      out.push(cifPassRow(loc));
    }
  }
  for (const d of darwin) {
    const tpl = cifTpl(d);
    if (used.has(tpl)) continue;
    const mins = callClock(d);
    // Skip clockless extras — splicing at end created orphan tipocs after destination.
    if (mins == null) continue;
    let at = out.length;
    for (let i = 0; i < out.length; i++) {
      const om = callClock(out[i]);
      if (om != null && om > mins) {
        at = i;
        break;
      }
    }
    out.splice(at, 0, d);
    used.add(tpl);
  }
  return out;
}

function mergeCifBetweenDarwinAnchors(darwin, cif) {
  const darwinSet = new Set(darwin.map((c) => cifTpl(c)));
  const out = [];
  let cifFrom = 0;
  for (let i = 0; i < darwin.length; i++) {
    out.push(darwin[i]);
    if (i === darwin.length - 1) break;
    const ia = findCifTpl(cif, darwin[i].tiploc, cifFrom);
    if (ia < 0) continue;
    const ib = findCifTpl(cif, darwin[i + 1].tiploc, ia + 1);
    if (ib < 0) continue;
    const extras = cif.slice(ia + 1, ib);
    const mismatch = extras.some((loc) => cifLocIsPublic(loc) && !darwinSet.has(cifTpl(loc)));
    if (mismatch) continue;
    for (const loc of extras) {
      const tpl = cifTpl(loc);
      if (darwinSet.has(tpl)) continue;
      darwinSet.add(tpl);
      out.push(cifPassRow(loc));
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
