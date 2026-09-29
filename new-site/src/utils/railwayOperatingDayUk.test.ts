import { describe, expect, it } from 'vitest'
import {
  railwayDayMinutesFromHhmm,
  scheduledTimeInRailwayWindow,
} from './railwayOperatingDayUk'

describe('scheduledTimeInRailwayWindow', () => {
  it('includes times from the operating-day start for a full day', () => {
    expect(scheduledTimeInRailwayWindow('02:00', '02:00', 24)).toBe(true)
    expect(scheduledTimeInRailwayWindow('23:59', '02:00', 24)).toBe(true)
    expect(scheduledTimeInRailwayWindow('01:35', '02:00', 24)).toBe(true)
  })

  it('slices from a later start like a location search time', () => {
    expect(scheduledTimeInRailwayWindow('07:59', '08:00', 3)).toBe(false)
    expect(scheduledTimeInRailwayWindow('08:00', '08:00', 3)).toBe(true)
    expect(scheduledTimeInRailwayWindow('10:59', '08:00', 3)).toBe(true)
    expect(scheduledTimeInRailwayWindow('11:00', '08:00', 3)).toBe(false)
  })
})

describe('railwayDayMinutesFromHhmm', () => {
  it('wraps post-midnight times after the 02:00 origin', () => {
    expect(railwayDayMinutesFromHhmm('02:00')).toBe(120)
    expect(railwayDayMinutesFromHhmm('01:00')).toBe(1500)
  })
})
