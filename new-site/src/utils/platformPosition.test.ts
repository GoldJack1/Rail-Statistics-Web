import { describe, expect, it } from 'vitest'
import {
  normalizePlatformRef,
  platformSitsAtStation,
  resolvePlatform,
  stationBookedRef,
  parsePlatformQuery,
} from './platformPosition'

describe('normalizePlatformRef', () => {
  it('treats wording and leading zeros as the same platform', () => {
    expect(normalizePlatformRef('Platform 02')).toBe('2')
    expect(normalizePlatformRef('0')).toBe('0')
    expect(normalizePlatformRef('2a')).toBe('2A')
    expect(normalizePlatformRef('15B')).toBe('15B')
    expect(normalizePlatformRef('15')).not.toBe(normalizePlatformRef('15B'))
  })
})

describe('platformSitsAtStation', () => {
  it('drops a platform that belongs to a different station', () => {
    const redcar = { lat: 54.61623, lng: -1.07087 }
    const southport = {
      lat: 53.64592,
      lng: -3.00174,
      ends: [
        { lat: 53.64553, lng: -3.00113 },
        { lat: 53.64672, lng: -3.00303 },
      ] as [{ lat: number; lng: number }, { lat: number; lng: number }],
    }
    expect(platformSitsAtStation(redcar, southport)).toBe(false)
    expect(
      platformSitsAtStation(redcar, {
        lat: 54.6161,
        lng: -1.0705,
        stand: { lat: 54.6162, lng: -1.0706 },
      }),
    ).toBe(true)
  })
})

describe('resolvePlatform', () => {
  it('stands between the lettered faces when the timetable has no suffix', () => {
    const matched = resolvePlatform(
      {
        '15A': { lat: 53.79397, lng: -1.54861 },
        '15B': { lat: 53.79422, lng: -1.5469 },
      },
      '15',
    )
    expect(matched?.lat).toBeCloseTo((53.79397 + 53.79422) / 2, 5)
    expect(matched?.lng).toBeCloseTo((-1.54861 + -1.5469) / 2, 5)
    expect(resolvePlatform({ '15B': { lat: 53.796, lng: -1.549 } }, '15B')).toMatchObject({
      lat: 53.796,
      lng: -1.549,
    })
    expect(resolvePlatform({ '15B': { lat: 53.796, lng: -1.549 } }, '16')).toBeNull()
  })
})

describe('stationBookedRef', () => {
  it('books 4, 4A and 4B at Huddersfield as platform 3', () => {
    const huddersfield = { lat: 53.64843, lng: -1.78515 }
    expect(stationBookedRef(huddersfield, '4B')).toBe('3')
    expect(stationBookedRef(huddersfield, '4A')).toBe('3')
    expect(stationBookedRef(huddersfield, '2')).toBe('2')
    expect(stationBookedRef({ lat: 53.79, lng: -1.55 }, '4B')).toBe('4B')
  })
})

describe('parsePlatformQuery', () => {
  it('reads id, position and platform', () => {
    expect(parsePlatformQuery('28~53.795~-1.548~15|0~53.48748~-2.2426~Platform%202')).toEqual([
      { id: '28', lat: 53.795, lng: -1.548, platform: '15' },
      { id: '0', lat: 53.48748, lng: -2.2426, platform: 'Platform 2' },
    ])
  })
})
