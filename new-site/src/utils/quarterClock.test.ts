import { describe, expect, it } from 'vitest'
import { formatQuarterClock } from './quarterClock'

describe('formatQuarterClock', () => {
  it('rounds TD seconds to the nearest quarter minute', () => {
    expect(formatQuarterClock('17:26:00')).toBe('17:26')
    expect(formatQuarterClock('17:26:07')).toBe('17:26')
    expect(formatQuarterClock('17:26:08')).toBe('17:26¼')
    expect(formatQuarterClock('17:26:15')).toBe('17:26¼')
    expect(formatQuarterClock('17:26:30')).toBe('17:26½')
    expect(formatQuarterClock('17:26:45')).toBe('17:26¾')
    expect(formatQuarterClock('17:26:53')).toBe('17:27')
  })

  it('keeps a working-timetable half minute', () => {
    expect(formatQuarterClock('13:02½')).toBe('13:02½')
    expect(formatQuarterClock('17:24')).toBe('17:24')
  })
})
