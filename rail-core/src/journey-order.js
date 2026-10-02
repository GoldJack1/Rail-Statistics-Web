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

export function callScheduledMinutes(c) {
  return parseHmMinutes(
    c.std || c.sta || c.wtd || c.wta || c.wtp || c.ptd || c.pta || c.etd || c.eta || c.etp,
  );
}

export function journeyKey(minutes, overnightLong = false, seq = 0) {
  if (minutes == null) return 10_000_000 + (seq ?? 0);
  return railwayDayMinutes(minutes, overnightLong) * 1000 + (seq ?? 0);
}

function isOvernightLongRun(rows) {
  let seenEvening = false;
  const ordered = [...(rows || [])].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  for (const row of ordered) {
    const mins = callScheduledMinutes(row);
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

export function sortCallsByJourneyTime(rows) {
  const list = rows || [];
  const overnightLong = isOvernightLongRun(list);
  return [...list].sort((a, b) => {
    const d =
      journeyKey(callScheduledMinutes(a), overnightLong, a.seq) -
      journeyKey(callScheduledMinutes(b), overnightLong, b.seq);
    if (d) return d;
    return (Number(a.seq) || 0) - (Number(b.seq) || 0) || String(a.tiploc || "").localeCompare(String(b.tiploc || ""));
  });
}

export function publicJourneyEnds(calls) {
  const ordered = sortCallsByJourneyTime(calls || []).filter((c) => !Number(c.is_passing));
  if (!ordered.length) return { origin: null, dest: null };
  const origin = ordered.find((c) => c.crs) || ordered[0];
  const dest = ordered[ordered.length - 1];
  return { origin, dest };
}
