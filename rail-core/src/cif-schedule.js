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
