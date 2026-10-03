export const BOARD_WINDOW_OPTIONS = [
  { label: '1 hour', value: 1 },
  { label: '3 hours', value: 3 },
  { label: '6 hours', value: 6 },
  { label: '12 hours', value: 12 },
] as const

export const BOARD_WINDOW_VALUES = new Set(BOARD_WINDOW_OPTIONS.map((opt) => opt.value))

const DEFAULT_LIVE_HOURS = BOARD_WINDOW_OPTIONS[0].value

/** Live CIS window from `?hours=`; full operating-day boards stay at 24h. */
export function parseBoardWindowHours(
  raw: string | string[] | undefined | null,
  opts?: { fullDay?: boolean },
): number {
  if (opts?.fullDay) return 24
  const value = Array.isArray(raw) ? raw[0] : raw
  const n = Number(value)
  return BOARD_WINDOW_VALUES.has(n as 1 | 3 | 6 | 12) ? n : DEFAULT_LIVE_HOURS
}

export function snapshotMatchesBoardHours(
  snap: { windowHours?: number } | null | undefined,
  hours: number,
): boolean {
  if (!snap) return false
  const windowHours = Number(snap.windowHours)
  return Number.isFinite(windowHours) && windowHours === hours
}
