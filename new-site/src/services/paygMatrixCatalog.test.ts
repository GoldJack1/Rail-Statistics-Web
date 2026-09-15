import { describe, expect, it } from 'vitest'
import {
  formatPaygZoneLabel,
  matchZoneCapBand,
  parseMatrixDestination,
  parseZoneCapBands,
} from '@/services/paygMatrixParse'

describe('paygMatrixCatalog', () => {
  it('reads TFW singlePence destinations', () => {
    const fare = parseMatrixDestination('YSR', {
      destName: 'Ystrad Rhondda',
      destZone: '5',
      singlePence: 420,
      dailyCapPence: 920,
      weeklyCapPence: 2760,
    })
    expect(fare?.fares.peakStandardPence).toBe(420)
    expect(fare?.dailyCapPence).toBe(920)
    expect(fare?.weeklyCapPence).toBe(2760)
    expect(fare?.destZone).toBe('5')
    expect(fare?.hasOffPeak).toBe(false)
  })

  it('reads GWR anytime / off-peak destinations', () => {
    const fare = parseMatrixDestination('SAU', {
      destName: 'St Austell',
      anytimeSinglePence: 1150,
      offPeakSinglePence: 1140,
      weeklyCapPence: 7100,
    })
    expect(fare?.fares.peakStandardPence).toBe(1150)
    expect(fare?.fares.offPeakStandardPence).toBe(1140)
    expect(fare?.weeklyCapPence).toBe(7100)
    expect(fare?.hasOffPeak).toBe(true)
  })

  it('formats PAYG zone labels', () => {
    expect(formatPaygZoneLabel('7')).toBe('Zone 7')
    expect(formatPaygZoneLabel('1+2')).toBe('Zones 1+2')
    expect(formatPaygZoneLabel('2/3')).toBe('Zones 2/3')
    expect(formatPaygZoneLabel('NA')).toBe('')
    expect(formatPaygZoneLabel('')).toBe('')
  })

  it('matches the smallest covering TfW zone cap', () => {
    const bands = [
      {
        id: 'zone-1',
        title: 'Zone 1',
        minZone: 1,
        maxZone: 1,
        dailyCapPence: 590,
        weeklyCapPence: 1770,
      },
      {
        id: 'zone-1-7',
        title: 'Zone 1 - 7',
        minZone: 1,
        maxZone: 7,
        dailyCapPence: 920,
        weeklyCapPence: 2760,
      },
      {
        id: 'zone-2-7',
        title: 'Zone 2 - 7',
        minZone: 2,
        maxZone: 7,
        dailyCapPence: 850,
        weeklyCapPence: 2120,
      },
    ]
    expect(matchZoneCapBand(bands, '7', '1', 920, 2760)?.id).toBe('zone-1-7')
    expect(matchZoneCapBand(bands, '7', '5')?.id).toBe('zone-2-7')
    expect(matchZoneCapBand(bands, '6', '3')?.id).toBe('zone-2-7')
  })

  it('reads TfW cap rows from titles when minZone is missing', () => {
    const parsed = parseZoneCapBands([
      { type: 'Zone 1 - 7', dailyCapPence: 920, weeklyCapPence: 2760 },
      { type: 'Zone 2 - 7', dailyCapPence: 850, weeklyCapPence: 2120 },
    ])
    expect(parsed[0]).toMatchObject({ minZone: 1, maxZone: 7 })
    expect(parsed[1]).toMatchObject({ minZone: 2, maxZone: 7 })
  })
})

describe('payg matrix meta', () => {
  it('reads London SE station list and CRS from _meta', async () => {
    const { parseMatrixMetaStations, parseTfLMetaCapBands } = await import('@/services/paygMatrixParse')
    const stations = parseMatrixMetaStations([
      {
        originId: '910GEUSTON',
        naptanId: '910GEUSTON',
        name: 'London Euston Rail Station',
        crs: 'EUS',
        zone: '1',
      },
    ])
    expect(stations).toEqual([
      {
        crs: '910GEUSTON',
        name: 'London Euston Rail Station',
        zone: '1',
        displayCrs: 'EUS',
      },
    ])
    const caps = parseTfLMetaCapBands([
      {
        zoneRange: 'Zones 1-6',
        dailyPeakPence: 1630,
        weeklyMonSunPence: 8160,
      },
    ])
    expect(caps[0]).toMatchObject({
      title: 'Zones 1-6',
      minZone: 1,
      maxZone: 6,
      dailyCapPence: 1630,
      weeklyCapPence: 8160,
    })
  })
})
