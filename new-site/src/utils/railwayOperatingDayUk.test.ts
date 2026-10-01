import { describe, expect, it } from 'vitest'
import {
  railwayDayMinutesFromHhmm,
  scheduledTimeInRailwayWindow,
  scheduledTimeInCalendarWindow,
  normalizeClockHhmm,
} from './railwayOperatingDayUk'

describe('scheduledTimeInRailwayWindow', () => {
  it('includes times from midnight for a full calendar day', () => {
    expect(scheduledTimeInCalendarWindow('00:05', '00:00', 24)).toBe(true)
    expect(scheduledTimeInCalendarWindow('02:00', '00:00', 24)).toBe(true)
    expect(scheduledTimeInCalendarWindow('23:59', '00:00', 24)).toBe(true)
  })

  it('keeps 00:00–01:59 on the same railway day and stops at 02:00', () => {
    expect(scheduledTimeInRailwayWindow('23:50', '20:24', 12)).toBe(true)
    expect(scheduledTimeInRailwayWindow('00:10', '20:24', 12)).toBe(true)
    expect(scheduledTimeInRailwayWindow('01:59', '20:24', 12)).toBe(true)
    expect(scheduledTimeInRailwayWindow('02:00', '20:24', 12)).toBe(false)
    expect(scheduledTimeInRailwayWindow('07:00', '20:24', 12)).toBe(false)
  })

  it('slices from a later start like a location search time', () => {
    expect(scheduledTimeInRailwayWindow('07:59', '08:00', 3)).toBe(false)
    expect(scheduledTimeInRailwayWindow('08:00', '08:00', 3)).toBe(true)
    expect(scheduledTimeInRailwayWindow('10:59', '08:00', 3)).toBe(true)
    expect(scheduledTimeInRailwayWindow('11:00', '11:00', 1)).toBe(true)
    expect(scheduledTimeInRailwayWindow('23:00', '11:00', 1)).toBe(false)
    expect(scheduledTimeInRailwayWindow('23:00', '11:00', 12)).toBe(false)
  })

  it('treats working-timetable seconds as the same minute', () => {
    expect(scheduledTimeInRailwayWindow('08:10:30', '15:44', 1)).toBe(false)
    expect(scheduledTimeInRailwayWindow('15:44:30', '15:44', 1)).toBe(true)
  })
})

describe('normalizeClockHhmm', () => {
  it('accepts Safari type=time values with seconds', () => {
    expect(normalizeClockHhmm('15:44:00')).toBe('15:44')
    expect(normalizeClockHhmm('15:44')).toBe('15:44')
    expect(normalizeClockHhmm('1544')).toBe('15:44')
  })
})

describe('railwayDayMinutesFromHhmm', () => {
  it('wraps post-midnight times after the 02:00 origin', () => {
    expect(railwayDayMinutesFromHhmm('02:00')).toBe(120)
    expect(railwayDayMinutesFromHhmm('01:00')).toBe(1500)
  })
})
