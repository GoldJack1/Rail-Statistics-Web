const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function ukCalendarYmd(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(now)
  const day = parts.find((p) => p.type === 'day')?.value || '01'
  const month = parts.find((p) => p.type === 'month')?.value || '01'
  const year = parts.find((p) => p.type === 'year')?.value || '1970'
  return `${year}-${month}-${day}`
}

/** PTAC/Darwin unit days we still treat as current (matches daemon history retention). */
export const UNIT_DAY_RETENTION_DAYS = 90

/** PTAC often publishes diagrams 1–2 days ahead of the working day. */
export const UNIT_DAY_FUTURE_SLACK_DAYS = 2

export function isIsoUnitDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DAY.test(value)
}

export function unitDayFromValue(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const compact = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw.slice(0, 10)
  return isIsoUnitDay(compact) ? compact : null
}

function addUtcDays(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00Z`)
  if (!Number.isFinite(base.getTime())) return ymd
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

/**
 * Drop epoch junk (1970-01-01), unparseable keys, and leftover months-old
 * catalog dates so the units day picker only lists recent workings.
 */
export function isPlausibleUnitOperatingDay(
  value: string | null | undefined,
  todayYmd: string,
  retentionDays = UNIT_DAY_RETENTION_DAYS,
): boolean {
  const day = unitDayFromValue(value)
  if (!day) return false
  if (day < '2024-01-01') return false
  const min = addUtcDays(todayYmd, -Math.max(1, retentionDays))
  const max = addUtcDays(todayYmd, UNIT_DAY_FUTURE_SLACK_DAYS)
  return day >= min && day <= max
}
