const QUARTER_MARKS = ['', '¼', '½', '¾'] as const

/** Nearest quarter-minute, in the same form Realtime Trains uses (17:26¼). */
export function formatQuarterClock(value: string | null | undefined): string {
  if (!value) return ''
  const s = String(value).trim()
  const half = /^(\d{1,2}:\d{2})½$/.exec(s)
  if (half) return `${half[1]}½`
  const hms = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s)
  if (!hms) {
    const minute = /^(\d{1,2}:\d{2})/.exec(s)
    return minute ? minute[1] : s.slice(0, 5)
  }
  let hour = Number(hms[1])
  let minute = Number(hms[2])
  const second = Number(hms[3])
  let quarter = Math.round(second / 15)
  if (quarter >= 4) {
    quarter = 0
    minute += 1
    if (minute >= 60) {
      minute = 0
      hour = (hour + 1) % 24
    }
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${QUARTER_MARKS[quarter]}`
}
