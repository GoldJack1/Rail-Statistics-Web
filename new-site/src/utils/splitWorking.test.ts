import { describe, expect, it } from 'vitest'
import { boardDestinationLabel, buildSplitWorking, isPassengerHeadcode, joinStationNames, serviceDestinationLabel, splitPortionLabel, splitTogetherLabel } from './splitWorking'
import type { ServiceDetail, ServiceStop } from '../types/darwin'

function stop(tpl: string, name: string, slot: string): ServiceStop {
  return {
    tpl,
    name,
    crs: null,
    slot,
    pta: null,
    ptd: null,
    wta: null,
    wtd: null,
    wtp: null,
    ata: null,
    atd: null,
    atp: null,
    platform: null,
    livePlatform: null,
    activity: null,
    liveTime: null,
    liveKind: 'scheduled',
    cancelledAtStop: false,
    cancelReasonAtStop: null,
    loadingPercentage: null,
    coachLoading: null,
    actualSource: null,
  }
}

function svc(partial: Partial<ServiceDetail> & Pick<ServiceDetail, 'rid' | 'uid' | 'trainId' | 'stops'>): ServiceDetail {
  return {
    ssd: '2026-10-02',
    toc: 'XC',
    tocName: 'CrossCountry',
    trainCat: null,
    isPassenger: true,
    origin: '',
    originName: '',
    destination: '',
    destinationName: '',
    cancelled: false,
    cancellation: null,
    partiallyCancelled: false,
    delayReason: null,
    reverseFormation: false,
    formation: null,
    consist: null,
    associations: [],
    alerts: [],
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('joinStationNames', () => {
  it('uses an ampersand between two stations', () => {
    expect(joinStationNames(['Cardiff Central', 'Plymouth'])).toBe('Cardiff Central & Plymouth')
  })
})

describe('boardDestinationLabel', () => {
  it('joins extra divide destinations with an ampersand', () => {
    expect(boardDestinationLabel({
      destinationName: 'Cardiff Central',
      associationDestinations: ['Plymouth'],
    })).toBe('Cardiff Central & Plymouth')
  })
})

describe('isPassengerHeadcode', () => {
  it('keeps passenger 1/2/9 and drops ECS/freight 0 and 3–8', () => {
    expect(isPassengerHeadcode('1P83')).toBe(true)
    expect(isPassengerHeadcode('2A00')).toBe(true)
    expect(isPassengerHeadcode('9W01')).toBe(true)
    expect(isPassengerHeadcode('5P83')).toBe(false)
    expect(isPassengerHeadcode('0B00')).toBe(false)
    expect(isPassengerHeadcode('')).toBe(true)
  })
})

describe('buildSplitWorking', () => {
  it('keeps the shared run then splits each portion', () => {
    const main = svc({
      rid: 'R1',
      uid: 'G01161',
      trainId: '1V64',
      destinationName: 'Cardiff Central',
      stops: [
        stop('EDINBUR', 'Edinburgh', 'OR'),
        stop('YORK', 'York', 'PP'),
        stop('GLOSTER', 'Gloucester', 'IP'),
        stop('CRDFCEN', 'Cardiff Central', 'DT'),
      ],
      associations: [{
        category: 'VV',
        tiploc: 'GLOSTER',
        tiplocName: 'Gloucester',
        tiplocCrs: null,
        mainRid: 'R1',
        assocRid: 'R2',
        role: 'main',
        otherRid: 'R2',
        otherUid: 'G66477',
        otherTrainId: '1C64',
        otherToc: 'XC',
        otherOriginName: 'Gloucester',
        otherDestinationName: 'Plymouth',
        mainTime: null,
        assocTime: null,
        isCancelled: false,
        isDeleted: false,
      }],
    })
    const other = svc({
      rid: 'R2',
      uid: 'G66477',
      trainId: '1C64',
      destinationName: 'Plymouth',
      stops: [
        stop('GLOSTER', 'Gloucester', 'OR'),
        stop('BRSTLTM', 'Bristol Temple Meads', 'PP'),
        stop('PLYMTH', 'Plymouth', 'DT'),
      ],
    })
    const split = buildSplitWorking(main, [other])
    expect(split?.splitName).toBe('Gloucester')
    expect(split?.togetherStops.map((s) => s.tpl)).toEqual(['EDINBUR', 'YORK', 'GLOSTER'])
    expect(split?.portions.find((p) => p.trainId === '1C64')?.stops.map((s) => s.tpl)).toEqual([
      'GLOSTER',
      'BRSTLTM',
      'PLYMTH',
    ])
    expect(split?.portions.find((p) => p.trainId === '1V64')?.stops.map((s) => s.tpl)).toEqual([
      'GLOSTER',
      'CRDFCEN',
    ])
    expect(split?.portions.map((p) => `${p.trainId}:${p.destinationName}`)).toEqual([
      '1V64:Cardiff Central',
      '1C64:Plymouth',
    ])
    expect(splitTogetherLabel(split!)).toBe('1V64 Edinburgh to Gloucester')
    expect(splitPortionLabel(split!.portions.find((p) => p.trainId === '1V64')!, split!.splitName)).toBe(
      '1V64 Gloucester to Cardiff Central',
    )
    expect(serviceDestinationLabel(main)).toBe('Cardiff Central & Plymouth')
  })

  it('ignores association partners that split at a different station', () => {
    const main = svc({
      rid: 'R1',
      uid: 'G01161',
      trainId: '1V64',
      destinationName: 'Cardiff Central',
      stops: [
        stop('EDINBUR', 'Edinburgh', 'OR'),
        stop('YORK', 'York', 'IP'),
        stop('GLOSTER', 'Gloucester', 'IP'),
        stop('CRDFCEN', 'Cardiff Central', 'DT'),
      ],
      associations: [
        {
          category: 'VV',
          tiploc: 'GLOSTER',
          tiplocName: 'Gloucester',
          tiplocCrs: null,
          mainRid: 'R1',
          assocRid: 'R2',
          role: 'main',
          otherRid: 'R2',
          otherUid: 'G66477',
          otherTrainId: '1C64',
          otherToc: 'XC',
          otherOriginName: 'Gloucester',
          otherDestinationName: 'Plymouth',
          mainTime: null,
          assocTime: null,
          isCancelled: false,
          isDeleted: false,
        },
        {
          category: 'VV',
          tiploc: 'YORK',
          tiplocName: 'York',
          tiplocCrs: null,
          mainRid: 'R1',
          assocRid: 'R3',
          role: 'main',
          otherRid: 'R3',
          otherUid: 'G09999',
          otherTrainId: '1D74',
          otherToc: 'XC',
          otherOriginName: 'York',
          otherDestinationName: 'Nottingham',
          mainTime: null,
          assocTime: null,
          isCancelled: false,
          isDeleted: false,
        },
      ],
    })
    const plymouth = svc({
      rid: 'R2',
      uid: 'G66477',
      trainId: '1C64',
      destinationName: 'Plymouth',
      stops: [stop('GLOSTER', 'Gloucester', 'OR'), stop('PLYMTH', 'Plymouth', 'DT')],
    })
    const nottingham = svc({
      rid: 'R3',
      uid: 'G09999',
      trainId: '1D74',
      destinationName: 'Nottingham',
      stops: [stop('YORK', 'York', 'OR'), stop('NOTNGHM', 'Nottingham', 'DT')],
    })
    const split = buildSplitWorking(main, [plymouth, nottingham])
    expect(split?.portions.map((p) => p.trainId)).toEqual(['1V64', '1C64'])
  })

  it('cuts the continuing portion after sorting a scrambled stop list', () => {
    const main = svc({
      rid: 'R1',
      uid: 'G01161',
      trainId: '1V64',
      destinationName: 'Cardiff Central',
      stops: [
        stop('NWCSTLE', 'Newcastle', 'IP'),
        stop('GLOSTER', 'Gloucester', 'IP'),
        stop('DRHM', 'Durham', 'IP'),
        stop('EDINBUR', 'Edinburgh', 'OR'),
        stop('CRDFCEN', 'Cardiff Central', 'DT'),
      ],
      associations: [{
        category: 'VV',
        tiploc: 'GLOSTER',
        tiplocName: 'Gloucester',
        tiplocCrs: null,
        mainRid: 'R1',
        assocRid: 'R2',
        role: 'main',
        otherRid: 'R2',
        otherUid: 'G66477',
        otherTrainId: '1C64',
        otherToc: 'XC',
        otherOriginName: 'Gloucester',
        otherDestinationName: 'Plymouth',
        mainTime: null,
        assocTime: null,
        isCancelled: false,
        isDeleted: false,
      }],
    })
    main.stops[0] = { ...main.stops[0], ptd: '14:33' }
    main.stops[1] = { ...main.stops[1], pta: '19:00', ptd: '19:12' }
    main.stops[2] = { ...main.stops[2], ptd: '14:53' }
    main.stops[3] = { ...main.stops[3], ptd: '13:05' }
    main.stops[4] = { ...main.stops[4], pta: '20:06' }
    const other = svc({
      rid: 'R2',
      uid: 'G66477',
      trainId: '1C64',
      destinationName: 'Plymouth',
      stops: [
        { ...stop('GLOSTER', 'Gloucester', 'OR'), ptd: '19:12' },
        { ...stop('PLYMTH', 'Plymouth', 'DT'), pta: '21:51' },
      ],
    })
    const split = buildSplitWorking(main, [other])
    expect(split?.togetherStops.map((s) => s.tpl)).toEqual(['EDINBUR', 'NWCSTLE', 'DRHM', 'GLOSTER'])
    expect(split?.portions.find((p) => p.trainId === '1V64')?.stops.map((s) => s.tpl)).toEqual(['GLOSTER', 'CRDFCEN'])
  })

  it('does not replace this service with the train it joins', () => {
    const portion = svc({
      rid: 'R2',
      uid: 'G01082',
      trainId: '1S53',
      originName: 'Penzance',
      destinationName: 'Edinburgh',
      stops: [
        stop('PENZNCE', 'Penzance', 'OR'),
        stop('PLYMTH', 'Plymouth', 'IP'),
        stop('EDINBUR', 'Edinburgh', 'DT'),
      ],
      associations: [{
        category: 'VV',
        tiploc: 'PLYMTH',
        tiplocName: 'Plymouth',
        tiplocCrs: null,
        mainRid: 'R1',
        assocRid: 'R2',
        role: 'associated',
        otherRid: 'R1',
        otherUid: 'G01135',
        otherTrainId: '1V46',
        otherToc: 'XC',
        otherOriginName: 'York',
        otherDestinationName: 'Plymouth',
        mainTime: null,
        assocTime: null,
        isCancelled: false,
        isDeleted: false,
      }],
    })
    const other = svc({
      rid: 'R1',
      uid: 'G01135',
      trainId: '1V46',
      stops: [stop('YORK', 'York', 'OR'), stop('PLYMTH', 'Plymouth', 'DT')],
    })
    expect(buildSplitWorking(portion, [other])).toBeNull()
  })

  it('ignores ECS headcodes such as 5P83 so they do not look like a split', () => {
    const main = svc({
      rid: 'R1',
      uid: 'G15982',
      trainId: '1P83',
      destinationName: 'Saltburn',
      stops: [stop('MNCROXR', 'Manchester Oxford Road', 'OR'), stop('SLTB', 'Saltburn', 'DT')],
      associations: [{
        category: 'VV',
        tiploc: 'MNCROXR',
        tiplocName: 'Manchester Oxford Road',
        tiplocCrs: null,
        mainRid: 'R1',
        assocRid: 'R2',
        role: 'main',
        otherRid: 'R2',
        otherUid: 'N63312',
        otherTrainId: '5P83',
        otherToc: 'TP',
        otherOriginName: 'Manchester',
        otherDestinationName: 'Manchester Depot',
        mainTime: null,
        assocTime: null,
        isCancelled: false,
        isDeleted: false,
      }],
    })
    const ecs = svc({
      rid: 'R2',
      uid: 'N63312',
      trainId: '5P83',
      stops: [stop('MNCROXR', 'Manchester Oxford Road', 'OR')],
    })
    expect(buildSplitWorking(main, [ecs])).toBeNull()
  })
})
