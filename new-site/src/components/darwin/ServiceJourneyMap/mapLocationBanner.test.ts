import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '@/types/darwin'
import type { LiveJourneyPosition } from '@/utils/serviceJourneyMap'
import { mapLocationBanner, portionBannerTitle } from './mapLocationBanner'

function stop(partial: Partial<ServiceStop> & Pick<ServiceStop, 'tpl' | 'slot'>): ServiceStop {
  return {
    name: partial.tpl,
    crs: null,
    pta: null,
    ptd: null,
    wta: null,
    wtd: null,
    wtp: null,
    platform: null,
    livePlatform: null,
    activity: null,
    liveTime: null,
    liveKind: 'scheduled',
    cancelledAtStop: false,
    cancelReasonAtStop: null,
    loadingPercentage: null,
    coachLoading: null,
    ...partial,
  }
}

function point(index: number, name: string, tpl: string, kind: 'stop' | 'pass'): LiveJourneyPosition['from'] {
  return {
    index,
    lat: 0,
    lng: 0,
    name,
    tpl,
    crs: null,
    calling: kind === 'stop',
    kind,
    cancelled: false,
    platform: null,
  }
}

describe('portionBannerTitle', () => {
  it('names a portion by its headcode and the stations at each end', () => {
    expect(portionBannerTitle('1B01', [
      stop({ tpl: 'FRTWLM', name: 'Fort William', slot: 'OR' }),
      stop({ tpl: 'EDINBUR', name: 'Edinburgh', slot: 'DT' }),
    ])).toBe('1B01 · Fort William → Edinburgh')
  })
})

describe('mapLocationBanner', () => {
  it('names a passed point and the expected next point, with lateness', () => {
    const stops = [
      stop({ tpl: 'MOSS', name: 'Mossley', slot: 'PP', wtp: '09:57', atp: '10:00', liveKind: 'actual' }),
      stop({ tpl: 'SYB', name: 'Stalybridge', slot: 'PP', wtp: '10:00', etp: '10:03', liveKind: 'est' }),
    ]
    const banner = mapLocationBanner(stops, {
      lat: 0,
      lng: 0,
      label: 'Between Mossley and Stalybridge',
      atStation: false,
      from: point(0, 'Mossley', 'MOSS', 'pass'),
      to: point(1, 'Stalybridge', 'SYB', 'pass'),
    })
    expect(banner?.text).toBe('Between Mossley (Passed at 10:00 3 min late) and Stalybridge (Expected at 10:03 3 min late)')
    expect(banner?.tone).toBe('delay-1')
  })

  it('says when the train arrived and when it is expected to leave', () => {
    const stops = [
      stop({
        tpl: 'LDS',
        name: 'Leeds',
        slot: 'IP',
        wta: '10:00',
        wtd: '10:10',
        ata: '10:00',
        liveKind: 'actual-arr',
      }),
    ]
    const banner = mapLocationBanner(stops, {
      lat: 0,
      lng: 0,
      label: 'At Leeds',
      atStation: true,
      from: point(0, 'Leeds', 'LDS', 'stop'),
      to: point(0, 'Leeds', 'LDS', 'stop'),
    })
    expect(banner?.text).toBe('Arrived at Leeds On Time at 10:00, Expected to Depart at 10:10')
    expect(banner?.tone).toBe('ontime')
  })

  it('keeps a late expected departure on the station line', () => {
    const stops = [
      stop({
        tpl: 'LDS',
        name: 'Leeds',
        slot: 'IP',
        wta: '10:00',
        wtd: '10:10',
        ata: '10:03',
        etd: '10:13',
        liveKind: 'actual-arr',
      }),
    ]
    const banner = mapLocationBanner(stops, {
      lat: 0,
      lng: 0,
      label: 'At Leeds',
      atStation: true,
      from: point(0, 'Leeds', 'LDS', 'stop'),
    })
    expect(banner?.text).toBe('Arrived at Leeds 3 min late at 10:03, Expected to Depart at 10:13 3 min late')
    expect(banner?.tone).toBe('delay-1')
  })

  it('uses the early colour when the train is ahead of the booked arrival', () => {
    const stops = [
      stop({ tpl: 'MANA', name: 'Manchester Airport', slot: 'DT', wta: '15:40', ata: '15:38', liveKind: 'actual-arr' }),
    ]
    const banner = mapLocationBanner(stops, {
      lat: 0,
      lng: 0,
      label: 'Arrived Manchester Airport',
      atStation: true,
      from: point(0, 'Manchester Airport', 'MANA', 'stop'),
    })
    expect(banner?.text).toBe('Arrived at Manchester Airport 2 min early at 15:38')
    expect(banner?.tone).toBe('early')
  })

  it('colours a cancelled service as cancelled', () => {
    const stops = [
      stop({ tpl: 'LDS', name: 'Leeds', slot: 'IP', wta: '10:00', wtd: '10:10', ata: '10:00', liveKind: 'actual-arr' }),
    ]
    const banner = mapLocationBanner(
      stops,
      {
        lat: 0,
        lng: 0,
        label: 'At Leeds',
        atStation: true,
        from: point(0, 'Leeds', 'LDS', 'stop'),
      },
      { cancelled: true },
    )
    expect(banner?.tone).toBe('cancelled')
    expect(banner?.text).toBe('Arrived at Leeds On Time at 10:00, Expected to Depart at 10:10')
  })
})
