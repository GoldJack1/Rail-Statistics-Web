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

export function isWorkingPass(c) {
  // A passenger stop needs a public time. A working dwell with no public
  // arrival or departure is a pass, even when the timetable books a few seconds.
  return !isAdvertisedCall(c);
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

function isOvernightLongRun(rows, minutesOf = callScheduledMinutes) {
  let seenEvening = false;
  const ordered = [...(rows || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  for (const row of ordered) {
    const mins = minutesOf(row);
    if (mins == null) continue;
    if (mins >= 18 * 60) seenEvening = true;
    if (seenEvening && mins < 12 * 60) return true;
  }
  return false;
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

function bookedInstant(c) {
  const raw = c?.wtp || c?.wtd || c?.wta || c?.std || c?.sta;
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!m) return null;
  let secs = Number(m[1]) * 3600 + Number(m[2]) * 60;
  if (/½/.test(text)) secs += 30;
  return secs;
}

/** A rounded copy (13:07 against 13:07½) is the same visit. A later return is not. */
function sameBookedVisit(a, b) {
  const ta = bookedInstant(a);
  const tb = bookedInstant(b);
  if (ta == null || tb == null) return ta == null && tb == null;
  let delta = Math.abs(ta - tb);
  if (delta > 12 * 3600) delta = 86400 - delta;
  return delta <= 60;
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
    if (hasHalfMinute(a?.[key]) && !hasHalfMinute(b?.[key])) return a[key];
    if (hasHalfMinute(b?.[key]) && !hasHalfMinute(a?.[key])) return b[key];
    return merged[key];
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
  const overnightLong = isOvernightLongRun(list, minutesOf);
  return [...list].sort((a, b) => {
    const d =
      journeyKey(minutesOf(a), overnightLong, a.seq) - journeyKey(minutesOf(b), overnightLong, b.seq);
    if (d) return d;
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
  const match = /^(\d{1,2}):(\d{2})/.exec(text);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 47 || mm > 59) return null;
  return (hh % 24) * 3600 + mm * 60 + (/½/.test(text) ? 30 : 0);
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

function wttSortSeconds(seconds, overnightLong) {
  if (seconds == null) return null;
  const dayMinutes = railwayDayMinutes(Math.floor(seconds / 60), overnightLong);
  return dayMinutes * 60 + (seconds % 60);
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
  const overnightLong = isOvernightLongRun(list, (row) => {
    const seconds = wttCallSeconds(row);
    return seconds == null ? null : Math.floor(seconds / 60);
  });
  const rank = (seconds) => wttSortSeconds(seconds, overnightLong);
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
  if (c.wtd && std && clockGapMinutes(std, c.wtd) >= 8) {
    if (!c.atd || clockGapMinutes(std, c.atd) <= 2 || clockGapMinutes(std, c.wtd) >= 12) {
      out.std = String(c.wtd).slice(0, 5);
    }
  }
  if (c.wta && sta && clockGapMinutes(sta, c.wta) >= 8) {
    if (!c.ata || clockGapMinutes(sta, c.ata) <= 2 || clockGapMinutes(sta, c.wta) >= 12) {
      out.sta = String(c.wta).slice(0, 5);
    }
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
