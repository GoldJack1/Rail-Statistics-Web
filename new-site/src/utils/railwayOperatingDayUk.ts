/**
 * UK **operating day** boundary used by the Darwin daemon and departures UI.
 * Labelled day runs **02:00 → 01:59** the next calendar morning (Europe/London).
 * Must stay aligned with `railwayDayYmd` / `UK_RAILWAY_DAY_START_MINUTES` in
 * `darwin-local-test/departures-daemon.mjs`.
 */
export const UK_RAILWAY_DAY_START_MINUTES = 2 * 60

/** HH:MM at the Darwin operating-day boundary (02:00 Europe/London). */
export const DARWIN_HISTORICAL_DAY_START = '02:00'

/** Lookahead used to load a full saved historical day in one request (RTT-style). */
export const DARWIN_HISTORICAL_DAY_HOURS = 24

export function normalizeClockHhmm(raw: string): string | null {
  const t = raw.trim()
  if (!t) return ''
  if (/^\d{3,4}$/.test(t)) {
    const padded = t.padStart(4, '0')
    const hour = Number(padded.slice(0, 2))
    const minute = Number(padded.slice(2, 4))
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
    return null
  }
  // Safari <input type="time"> often yields HH:MM:SS, not HH:MM.
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(t)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function hhmmToMinutes(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(hhmm.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** Minutes from the 02:00 operating-day origin (00:00–01:59 wrap into the following morning). */
export function railwayDayMinutesFromHhmm(hhmm: string): number | null {
  const clock = hhmmToMinutes(hhmm)
  if (clock == null) return null
  return clock < UK_RAILWAY_DAY_START_MINUTES ? clock + 24 * 60 : clock
}

/** True when a public scheduled time falls in [start, start + hours) on the operating day. */
export function scheduledTimeInRailwayWindow(
  scheduledTime: string,
  windowStartHhmm: string,
  windowHours: number,
): boolean {
  const rowMins = railwayDayMinutesFromHhmm(scheduledTime)
  const startMins = railwayDayMinutesFromHhmm(windowStartHhmm)
  if (rowMins == null || startMins == null) return true
  const span = Math.max(1, windowHours) * 60
  return rowMins >= startMins && rowMins < startMins + span
}

/**
 * Operating-day YYYY-MM-DD from London wall-clock components (same pseudo-UTC
 * composition as the daemon’s `railwayDayYmd`).
 */
export function railwayOperatingDayIsoFromLondonParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const londonAsUtcMs = Date.UTC(year, month - 1, day, hour, minute)
  const railwayDayUtcMs = londonAsUtcMs - UK_RAILWAY_DAY_START_MINUTES * 60 * 1000
  return new Date(railwayDayUtcMs).toISOString().slice(0, 10)
}
