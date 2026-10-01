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

export function railwayDayMinutes(clockMins) {
  if (clockMins == null) return null;
  return clockMins < RAILWAY_DAY_START_MINUTES ? clockMins + 1440 : clockMins;
}

export function callScheduledMinutes(c) {
  return parseHmMinutes(
    c.std || c.sta || c.wtd || c.wta || c.wtp || c.ptd || c.pta || c.etd || c.eta || c.etp,
  );
}

export function journeyKey(minutes, _allMinutes, seq = 0) {
  if (minutes == null) return 10_000_000 + (seq ?? 0);
  return railwayDayMinutes(minutes) * 1000 + (seq ?? 0);
}

export function sortCallsByJourneyTime(rows) {
  const all = rows.map(callScheduledMinutes);
  return [...rows].sort((a, b) => {
    const d =
      journeyKey(callScheduledMinutes(a), all, a.seq) -
      journeyKey(callScheduledMinutes(b), all, b.seq);
    if (d) return d;
    return String(a.tiploc || "").localeCompare(String(b.tiploc || ""));
  });
}

export function publicJourneyEnds(calls) {
  const ordered = sortCallsByJourneyTime(calls || []).filter((c) => !Number(c.is_passing));
  if (!ordered.length) return { origin: null, dest: null };
  const origin = ordered.find((c) => c.crs) || ordered[0];
  const dest = ordered[ordered.length - 1];
  return { origin, dest };
}
