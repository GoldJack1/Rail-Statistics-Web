/** Order calling points along the train on the UK railway day (02:00 → 01:59). */

export const RAILWAY_DAY_START_MINUTES = 2 * 60;

export function parseHmMinutes(value) {
  if (value == null || value === "") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 47 || mm > 59) return null;
  return (hh % 24) * 60 + mm;
}

export function railwayDayMinutes(clockMins, overnightLong = false) {
  if (clockMins == null) return null;
  if (overnightLong) return clockMins < 12 * 60 ? clockMins + 1440 : clockMins;
  return clockMins < RAILWAY_DAY_START_MINUTES ? clockMins + 1440 : clockMins;
}

/**
 * CIF and TRUST store 00:00 in the public fields of a working pass.
 * That is a real midnight call only when the working time is midnight too.
 */
export function publicCallTime(value, row) {
  if (value == null || value === "") return null;
  const hm = String(value).trim().slice(0, 5);
  if (hm !== "00:00") return String(value).trim();
  const work = parseHmMinutes(row?.wtp || row?.wtd || row?.wta);
  if (work == null || work === 0) return hm;
  return null;
}

export function isAdvertisedCall(c) {
  return Boolean(publicCallTime(c?.sta, c) || publicCallTime(c?.std, c));
}

function junctionTiploc(c) {
  return /(?:JN|JCN|JNCT|DJN)$/.test(String(c?.tiploc || "").toUpperCase());
}

export function isWorkingPass(c) {
  // A passenger stop needs a public time. A few seconds of working time is
  // still a pass. A real dwell, or a working arrival such as Edinburgh after
  // Inverkeithing, is where the train is booked to stop. A junction allowance
  // is not: Abbeyhill is the first timing point east of Waverley on every
  // East Coast train, and its working arrival and departure are not a call.
  if (isAdvertisedCall(c)) return false;
  if (junctionTiploc(c)) return true;
  const passTime = String(c?.wtp || "").trim();
  const arr = parseHmMinutes(c?.wta);
  const dep = parseHmMinutes(c?.wtd);
  if (arr != null && dep != null && !passTime) {
    let gap = dep - arr;
    if (gap < 0) gap += 24 * 60;
    if (gap >= 2 && gap < 12 * 60) return false;
  }
  if (arr != null && dep == null && !passTime && Number(c?.is_passing) === 0) return false;
  return true;
}

/** Public GBTT stop, including advertised TIPLOCs that never received a CRS. */
export function isPublicPassengerCall(c) {
  if (isWorkingPass(c)) return false;
  return isAdvertisedCall(c);
}

export function callScheduledMinutes(c) {
  return parseHmMinutes(
    publicCallTime(c.std, c) ||
      publicCallTime(c.sta, c) ||
      c.wtd ||
      c.wta ||
      c.wtp ||
      c.ptd ||
      c.pta ||
      c.etd ||
      c.eta ||
      c.etp,
  );
}

/** Booked timetable clock only. An estimate must not move the row. */
export function bookedCallMinutes(c) {
  return parseHmMinutes(
    publicCallTime(c?.std, c) ||
      publicCallTime(c?.sta, c) ||
      c?.wtd ||
      c?.wta ||
      c?.wtp ||
      c?.ptd ||
      c?.pta,
  );
}

export function journeyKey(minutes, overnightLong = false, seq = 0) {
  if (minutes == null) return 10_000_000 + (seq ?? 0);
  return railwayDayMinutes(minutes, overnightLong) * 1000 + (seq ?? 0);
}

const DAY_SECONDS = 24 * 3600;
const RAIL_START_SECONDS = RAILWAY_DAY_START_MINUTES * 60;
// A rotation has to remove a real hole. An hour either way is a long daytime
// leg, not a sleeper.
const ROTATION_MARGIN_SECONDS = 90 * 60;

function normaliseSeconds(seconds) {
  return ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

function offsetFromStart(seconds, start) {
  return (normaliseSeconds(seconds) - start + DAY_SECONDS) % DAY_SECONDS;
}

function railwayStartSeconds(times) {
  let best = times[0];
  let bestKey = Infinity;
  for (const time of times) {
    const key = time < RAIL_START_SECONDS ? time + DAY_SECONDS : time;
    if (key < bestKey) {
      bestKey = key;
      best = time;
    }
  }
  return best;
}

function maxInteriorGap(times, start) {
  const ordered = [...times].sort((a, b) => offsetFromStart(a, start) - offsetFromStart(b, start));
  let max = 0;
  for (let i = 1; i < ordered.length; i++) {
    const gap = offsetFromStart(ordered[i], start) - offsetFromStart(ordered[i - 1], start);
    if (gap > max) max = gap;
  }
  return max;
}

/**
 * Clock where the working timetable starts.
 * A sleeper that is still going after 02:00 starts in the evening: the long
 * gap is between the morning arrival and that departure. A daytime train
 * starts at its earliest clock, even when a morning portion was filed after
 * the evening terminus in schedule order.
 */
export function journeyStartSeconds(clocks) {
  const times = [...new Set((clocks || []).map(normaliseSeconds))];
  if (!times.length) return RAIL_START_SECONDS;
  if (times.length === 1) return railwayStartSeconds(times);
  const sorted = [...times].sort((a, b) => a - b);
  let maxGap = -1;
  let after = sorted[0];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    let gap = b - a;
    if (gap <= 0) gap += DAY_SECONDS;
    if (gap > maxGap) {
      maxGap = gap;
      after = b;
    }
  }
  const rail = railwayStartSeconds(sorted);
  if (after === rail) return rail;
  if (maxInteriorGap(sorted, rail) - maxInteriorGap(sorted, after) > ROTATION_MARGIN_SECONDS) return after;
  return rail;
}

function richerCall(a, b) {
  const score = (c) =>
    ["ata", "atd", "atp", "eta", "etd", "etp", "sta", "std", "wta", "wtd", "wtp"].reduce(
      (n, k) => n + (c?.[k] ? 1 : 0),
      0,
    );
  return score(b) > score(a) ? { ...a, ...b } : { ...b, ...a };
}

/** Adjacent Darwin day files often copy the same RID; keep one row per TIPLOC. */
export function collapseCallsByTiploc(rows) {
  const by = new Map();
  for (const c of rows || []) {
    const k = String(c.tiploc || "").toUpperCase();
    if (!k) continue;
    const prev = by.get(k);
    by.set(k, prev ? richerCall(prev, c) : c);
  }
  return sortCallsByJourneyTime([...by.values()]);
}

function clockSeconds(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!m) return null;
  let secs = Number(m[1]) * 3600 + Number(m[2]) * 60;
  if (/½/.test(text)) secs += 30;
  return secs;
}

function bookedInstant(c) {
  return clockSeconds(c?.wtp || c?.wtd || c?.wta || c?.std || c?.sta);
}

function clockGapSeconds(a, b) {
  let delta = Math.abs(a - b);
  if (delta > 12 * 3600) delta = 86400 - delta;
  return delta;
}

const VISIT_FIELDS = ["wta", "wtd", "wtp", "sta", "std"];

function visitClock(row, key) {
  const raw = key === "sta" || key === "std" ? publicCallTime(row?.[key], row) : row?.[key];
  return clockSeconds(raw);
}

/**
 * A rounded copy (13:07 against 13:07½) is the same visit. A later return is not.
 * Compare each booked field with itself. A pass time and the departure of the
 * same stop are different clocks, so a single earliest-clock check treats
 * 12:42 and 12:43½ as two calls.
 */
function sameBookedVisit(a, b) {
  let paired = false;
  const left = [];
  const right = [];
  for (const key of VISIT_FIELDS) {
    const ta = visitClock(a, key);
    const tb = visitClock(b, key);
    if (ta != null) left.push(ta);
    if (tb != null) right.push(tb);
    if (ta == null || tb == null) continue;
    paired = true;
    if (clockGapSeconds(ta, tb) <= 60) return true;
  }
  if (!left.length || !right.length) return left.length === 0 && right.length === 0;
  if (paired) return false;
  let best = Infinity;
  for (const ta of left) {
    for (const tb of right) best = Math.min(best, clockGapSeconds(ta, tb));
  }
  return best <= 90;
}

function hasHalfMinute(value) {
  return /½/.test(String(value || ""));
}

function mergeVisit(a, b) {
  const merged = richerCall(a, b);
  const seqA = Number(a?.seq);
  const seqB = Number(b?.seq);
  const seq = Math.min(
    Number.isFinite(seqA) ? seqA : Infinity,
    Number.isFinite(seqB) ? seqB : Infinity,
  );
  const pick = (key) => {
    const av = a?.[key];
    const bv = b?.[key];
    if (hasHalfMinute(av) && !hasHalfMinute(bv)) return av;
    if (hasHalfMinute(bv) && !hasHalfMinute(av)) return bv;
    if (av && bv) return merged[key];
    return av || bv || merged[key];
  };
  return {
    ...merged,
    seq: Number.isFinite(seq) ? seq : merged.seq,
    wtp: pick("wtp"),
    wtd: pick("wtd"),
    wta: pick("wta"),
    std: pick("std"),
    sta: pick("sta"),
  };
}

/**
 * A junction the train passes, calls beyond, then passes again on the way
 * back is two visits. Collapse a rounded copy of the same booked time.
 */
export function collapseRevisits(rows) {
  const out = [];
  for (const c of rows || []) {
    const tpl = String(c.tiploc || "").toUpperCase();
    if (!tpl) continue;
    let prev = -1;
    for (let i = 0; i < out.length; i++) {
      if (String(out[i].tiploc || "").toUpperCase() !== tpl) continue;
      if (!sameBookedVisit(out[i], c)) continue;
      prev = i;
      break;
    }
    if (prev < 0) out.push(c);
    else out[prev] = mergeVisit(out[prev], c);
  }
  return sortCallsByBookedTime(out);
}

function sortByMinutes(rows, minutesOf) {
  const list = rows || [];
  const clocks = [];
  for (const row of list) {
    const mins = minutesOf(row);
    if (mins == null) continue;
    clocks.push(mins * 60);
  }
  const start = journeyStartSeconds(clocks);
  const key = (row) => {
    const mins = minutesOf(row);
    if (mins == null) return null;
    return offsetFromStart(mins * 60, start);
  };
  return [...list].sort((a, b) => {
    const ak = key(a);
    const bk = key(b);
    if (ak == null && bk == null) return (Number(a.seq) || 0) - (Number(b.seq) || 0);
    if (ak == null) return 1;
    if (bk == null) return -1;
    if (ak !== bk) return ak - bk;
    return (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.tiploc || "").localeCompare(String(b.tiploc || ""));
  });
}

export function sortCallsByJourneyTime(rows) {
  return sortByMinutes(rows, callScheduledMinutes);
}

export function sortCallsByBookedTime(rows) {
  return sortByMinutes(rows, bookedCallMinutes);
}

function wttClockSeconds(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = match[3] != null ? Number(match[3]) : (/½/.test(text) ? 30 : 0);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss) || hh > 47 || mm > 59 || ss > 59) return null;
  return (hh % 24) * 3600 + mm * 60 + ss;
}

/**
 * Earliest working-timetable clock at this place. A half minute counts.
 * Public and live times are used only when the working time is missing,
 * so an estimate cannot pull a booked call out of the timetable.
 */
export function wttCallSeconds(call) {
  const working = ["wta", "wtd", "wtp"].map((key) => wttClockSeconds(call?.[key])).filter((n) => n != null);
  if (working.length) return Math.min(...working);
  const published = ["sta", "std", "pta", "ptd"]
    .map((key) => wttClockSeconds(publicCallTime(call?.[key], call)))
    .filter((n) => n != null);
  if (published.length) return Math.min(...published);
  const live = ["atp", "atd", "ata", "etp", "etd", "eta"]
    .map((key) => wttClockSeconds(call?.[key]))
    .filter((n) => n != null);
  if (live.length) return Math.min(...live);
  return null;
}

/** Booked clock only. A live time must not decide where a timed call sits. */
function timetableSeconds(call) {
  const working = ["wta", "wtd", "wtp"].map((key) => wttClockSeconds(call?.[key])).filter((n) => n != null);
  if (working.length) return Math.min(...working);
  const published = ["sta", "std", "pta", "ptd"]
    .map((key) => wttClockSeconds(publicCallTime(call?.[key], call)))
    .filter((n) => n != null);
  if (published.length) return Math.min(...published);
  return null;
}

function liveSeconds(call) {
  const live = ["ata", "atd", "atp", "eta", "etd", "etp"]
    .map((key) => wttClockSeconds(call?.[key]))
    .filter((n) => n != null);
  if (!live.length) return null;
  return Math.min(...live);
}

/**
 * Calling order is the working timetable. The same second keeps schedule order.
 * A report with no booked time is placed by its live clock against the live
 * clocks around it, so a late actual is not compared with the next station's
 * earlier booked time.
 */
export function sortCallsByWttTime(rows) {
  const list = rows || [];
  const booked = [];
  const floating = [];
  list.forEach((row, index) => {
    if (timetableSeconds(row) != null) booked.push({ row, index });
    else floating.push({ row, index });
  });
  const clocks = [];
  for (const row of list) {
    const seconds = timetableSeconds(row);
    if (seconds != null) clocks.push(seconds);
  }
  const start = journeyStartSeconds(clocks);
  const rank = (seconds) => (seconds == null ? null : offsetFromStart(seconds, start));
  const ordered = booked
    .sort((a, b) => {
      const left = rank(timetableSeconds(a.row));
      const right = rank(timetableSeconds(b.row));
      if (left == null && right == null) return a.index - b.index;
      if (left == null) return 1;
      if (right == null) return -1;
      if (left !== right) return left - right;
      return (Number(a.row.seq) || 0) - (Number(b.row.seq) || 0) || a.index - b.index;
    })
    .map((item) => item.row);
  floating.sort((a, b) => (rank(liveSeconds(a.row)) ?? 1e15) - (rank(liveSeconds(b.row)) ?? 1e15) || a.index - b.index);
  for (const item of floating) {
    const at = rank(liveSeconds(item.row));
    if (at == null) {
      ordered.push(item.row);
      continue;
    }
    let index = ordered.length;
    for (let i = 0; i < ordered.length; i++) {
      const ref = rank(liveSeconds(ordered[i]) ?? timetableSeconds(ordered[i]));
      if (ref == null) continue;
      if (ref > at) {
        index = i;
        break;
      }
    }
    ordered.splice(index, 0, item.row);
  }
  return ordered;
}

/** CIF often appends another working after Darwin's public terminus (seq jumps backward in time). */
function clockGapMinutes(a, b) {
  const am = parseHmMinutes(a);
  const bm = parseHmMinutes(b);
  if (am == null || bm == null) return null;
  let d = Math.abs(am - bm);
  if (d > 720) d = 1440 - d;
  return d;
}

/** Darwin schedule overlays sometimes copy an actual onto std/sta. Prefer WTT when they disagree. */
export function recoverBookedPublic(c) {
  if (!c) return c;
  const out = { ...c };
  const std = publicCallTime(c.std, c);
  const sta = publicCallTime(c.sta, c);
  // Only when the public clock is a copy of an actual. A later public arrival
  // than the working time is recovery, not a corrupted timetable.
  if (c.wtd && std && c.atd && clockGapMinutes(std, c.wtd) >= 8 && clockGapMinutes(std, c.atd) <= 2) {
    out.std = String(c.wtd).slice(0, 5);
  }
  if (c.wta && sta && c.ata && clockGapMinutes(sta, c.wta) >= 8 && clockGapMinutes(sta, c.ata) <= 2) {
    out.sta = String(c.wta).slice(0, 5);
  }
  return out;
}

export function dropCifTailAfterPublicTerminus(rows) {
  const ordered = [...(rows || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  let lastAdvMins = null;
  let lastAdvIdx = -1;
  const seenTpl = new Set();
  for (let i = 0; i < ordered.length; i++) {
    const c = ordered[i];
    if (!isAdvertisedCall(c)) continue;
    const tpl = String(c.tiploc || "").toUpperCase();
    const m = callScheduledMinutes(c);
    if (lastAdvMins != null && m != null) {
      let delta = m - lastAdvMins;
      if (delta < -12 * 60) delta += 1440;
      if (delta < -40) {
        // Another working starts at a stop this train has not called at.
        // A repeat of a stop already on the train is a second copy of the
        // same journey, and the passes filed with it belong on this train.
        if (!tpl || !seenTpl.has(tpl)) return ordered.slice(0, lastAdvIdx + 1);
        continue;
      }
    }
    if (tpl) seenTpl.add(tpl);
    if (m != null) lastAdvMins = m;
    lastAdvIdx = i;
  }
  return ordered;
}

export function publicJourneyEnds(calls) {
  const ordered = sortCallsByJourneyTime(calls || []).filter((c) => !isWorkingPass(c));
  if (!ordered.length) return { origin: null, dest: null };
  const advertised = ordered.filter(isPublicPassengerCall);
  const legs = advertised.length ? advertised : ordered.filter((c) => c.crs).length ? ordered.filter((c) => c.crs) : ordered;
  const origin = legs.find((c) => c.crs) || legs[0];
  const dest = legs[legs.length - 1];
  return { origin, dest };
}
