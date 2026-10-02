/** Europe/London civil calendar date (RTT location URLs), midnight rollover. */

export function londonCalendarYmd(now = new Date(), timeZone = "Europe/London") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Minutes Europe/London is ahead of UTC at this instant (60 during BST, 0 during GMT). */
export function londonOffsetMinutes(date) {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** A London wall-clock time on calendar date ymd, including the BST/GMT offset. */
export function londonInstant(ymd, hhmm) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmm || "").trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""))) return null;
  const [y, mo, d] = String(ymd).split("-").map(Number);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] || 0);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const utcGuess = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  return new Date(utcGuess.getTime() - londonOffsetMinutes(utcGuess) * 60_000);
}

export function addCalendarDays(ymd, n) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(n || 0)));
  return dt.toISOString().slice(0, 10);
}

export function ssdFromRid(rid) {
  const m = String(rid || "").match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * CS is always a sleeper. GWR Night Riviera is CIF category SL/SZ, or any GW
 * passenger run that starts in the evening and finishes the next morning.
 * Do not key this off headcodes — they change.
 */
export function isOvernightSleeperJourney(toc, category, firstMins, lastMins) {
  const t = String(toc || "").toUpperCase();
  if (t === "CS") return true;
  if (t !== "GW") return false;
  const cat = String(category || "").toUpperCase();
  if (cat === "SL" || cat === "SZ") return true;
  if (firstMins == null || lastMins == null) return false;
  // Night Riviera runs into the following morning — not last-trains that finish ~00:00–02:00.
  return firstMins >= 21 * 60 && lastMins >= 4 * 60 && lastMins < 12 * 60;
}

/** Day sqlite files to merge for a location search on calendar date D. */
export function locationBoardDays(boardDate) {
  const d = String(boardDate);
  return [addCalendarDays(d, -1), d];
}

/**
 * Darwin TS days to update. A rid dated tomorrow still has to land on today's
 * file when that file already holds the timetable, or the live overlay never
 * meets the board.
 */
export function darwinWriteDays(operatingDay, ridDay, hasRid) {
  const days = new Set();
  if (ridDay) days.add(ridDay);
  const op = String(operatingDay);
  if (!ridDay || ridDay <= op || hasRid(op)) days.add(op);
  const prev = addCalendarDays(op, -1);
  if (hasRid(prev)) days.add(prev);
  return [...days];
}

function clockMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Calendar date of a call: Darwin/CIF 00:00–01:59 on SSD is the next London date
 * (overnight continuation). New SSDs at 00:xx are rare; passenger day starts 02:00.
 */
export function callCalendarYmd(ssd, hhmm) {
  const mins = clockMinutes(hhmm);
  if (mins != null && mins < 120) return addCalendarDays(ssd, 1);
  return ssd;
}

/** True when this call belongs on Darwin railway day `boardDate` (02:00–01:59). */
export function callOnBoardDate(ssd, hhmm, boardDate) {
  return String(ssd) === String(boardDate);
}

/**
 * Next-day Darwin activations (new RID, afternoon times) must not appear on
 * today's CIS board. Overnight 00:00–01:59 on SSD+1 still belongs here.
 */
export function ridVisibleOnBoard(rid, hhmm, boardDate, meta = {}) {
  const ridDay = ssdFromRid(rid);
  if (!ridDay || !boardDate) return true;
  const mins = clockMinutes(hhmm);
  if (meta.overnightSleeper && ridDay < boardDate) {
    // After 02:00 this is yesterday's train: keep morning calls, drop last night's 21:00+ origin.
    return mins != null && mins < 12 * 60;
  }
  if (ridDay <= boardDate) return true;
  return mins != null && mins < 120 && ridDay === addCalendarDays(boardDate, 1);
}
