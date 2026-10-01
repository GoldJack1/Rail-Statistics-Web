/**
 * UK location-search date: Darwin railway day, 02:00–01:59 Europe/London.
 */
export const UK_RAILWAY_DAY_START_MINUTES = 2 * 60

export const DARWIN_HISTORICAL_DAY_START = '02:00'

export const DARWIN_HISTORICAL_DAY_HOURS = 24

export function ssdFromRid(rid: string): string | null {
  const match = String(rid || '').match(/^(\d{4})(\d{2})(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

export function londonCalendarYmdFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function londonCalendarYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00'
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

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

export function railwayDayMinutesFromHhmm(hhmm: string): number | null {
  const clock = hhmmToMinutes(hhmm)
  if (clock == null) return null
  return clock < UK_RAILWAY_DAY_START_MINUTES ? clock + 24 * 60 : clock
}

export function scheduledTimeInCalendarWindow(
  scheduledTime: string,
  windowStartHhmm: string,
  windowHours: number,
): boolean {
  const rowMins = hhmmToMinutes(scheduledTime)
  const startMins = hhmmToMinutes(windowStartHhmm)
  if (rowMins == null || startMins == null) return true
  const span = Math.max(1, windowHours) * 60
  const rel = rowMins - startMins
  if (rel < 0) return false
  return rel < span
}

export function scheduledTimeInRailwayWindow(
  scheduledTime: string,
  windowStartHhmm: string,
  windowHours: number,
): boolean {
  const rowMins = railwayDayMinutesFromHhmm(scheduledTime)
  const startMins = railwayDayMinutesFromHhmm(windowStartHhmm)
  if (rowMins == null || startMins == null) return true
  const span = Math.max(1, windowHours) * 60
  const railwayDayEnd = 24 * 60 + UK_RAILWAY_DAY_START_MINUTES
  const endMins = Math.min(startMins + span, railwayDayEnd)
  return rowMins >= startMins && rowMins < endMins
}

export function railwayOperatingDayIsoFromLondonParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const calendar = londonCalendarYmdFromParts(year, month, day)
  const clock = hour * 60 + minute
  if (clock < UK_RAILWAY_DAY_START_MINUTES) {
    const [y, m, d] = calendar.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d - 1))
    return dt.toISOString().slice(0, 10)
  }
  return calendar
}

export function currentRailwayOperatingDayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00'
  return railwayOperatingDayIsoFromLondonParts(
    Number(pick('year')),
    Number(pick('month')),
    Number(pick('day')),
    Number(pick('hour')),
    Number(pick('minute')),
  )
}
