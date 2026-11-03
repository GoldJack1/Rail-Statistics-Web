import { describe, expect, it } from 'vitest'
import { isRailCoreBoard, normalizeDeparturesSnapshot, normalizeServiceDetail } from './normalizeRailCore'

describe('normalizeRailCore', () => {
  it('maps compact query JSON onto DepartureRow', () => {
    const body = {
      generatedAt: '2026-09-30T12:00:00.000Z',
      station: { crs: 'PAD' },
      services: [
        {
          rid: 'r1',
          uid: 'u1',
          toc: 'GW',
          operatorName: 'GWR',
          destinationCrs: 'BRI',
          scheduled: '10:00',
          actual: '10:02',
          isPassing: true,
          serviceType: 'passenger',
          liveKind: 'actual',
          actualSource: 'darwin',
        },
      ],
    }
    expect(isRailCoreBoard(body)).toBe(true)
    const snap = normalizeDeparturesSnapshot(body, 'PAD')
    expect(snap.departures[0].scheduledTime).toBe('10:00')
    expect(snap.departures[0].isPassing).toBe(true)
    expect(snap.departures[0].actualSource).toBe('darwin')
  })

  it('drops the Crossrail tag from station names', () => {
    const snap = normalizeDeparturesSnapshot(
      {
        generatedAt: '2026-10-31T12:00:00.000Z',
        stationName: 'Paddington (Crossrail)',
        stationCrs: 'PAD',
        departures: [
          {
            rid: 'r1',
            destinationName: 'Abbey Wood (Crossrail)',
            originName: 'Paddington Crossrail',
            via: 'Stratford (London) (Crossrail)',
            scheduledTime: '10:00',
          },
        ],
        arrivals: [],
      },
      'PAD',
    )
    expect(snap.stationName).toBe('Paddington')
    expect(snap.departures[0].destinationName).toBe('Abbey Wood')
    expect(snap.departures[0].originName).toBe('Paddington')
    expect(snap.departures[0].via).toBe('Stratford (London)')

    const detail = normalizeServiceDetail({
      rid: 'r1',
      originName: 'Paddington (Crossrail)',
      destinationName: 'Abbey Wood (Crossrail)',
      stops: [{ tpl: 'ABWDXR', name: 'Abbey Wood (Crossrail)', slot: 'DT' }],
    })
    expect(detail.originName).toBe('Paddington')
    expect(detail.destinationName).toBe('Abbey Wood')
    expect(detail.stops[0].name).toBe('Abbey Wood')
  })

  it('fills liveKind from etd/atd on a query-server stops payload', () => {
    const detail = normalizeServiceDetail({
      rid: 'G15982',
      uid: 'G15982',
      trainId: '1P83',
      stops: [
        {
          tpl: 'MNCROXR',
          name: 'Manchester Oxford Road',
          crs: 'MCO',
          slot: 'OR',
          pta: null,
          ptd: '16:59',
          wta: null,
          wtd: '16:59',
          wtp: null,
          ata: null,
          atd: '16:59',
          atp: null,
          eta: null,
          etd: '16:59',
          etp: null,
          liveTime: '16:59',
          liveKind: 'working',
        },
        {
          tpl: 'DEWSBRY',
          name: 'Dewsbury',
          crs: 'DEW',
          slot: 'IP',
          pta: '18:20',
          ptd: '18:21',
          wta: '18:20',
          wtd: '18:21',
          wtp: null,
          ata: null,
          atd: null,
          atp: null,
          eta: '18:21',
          etd: '18:21',
          etp: null,
          liveTime: '18:21',
          liveKind: 'scheduled',
        },
      ],
    })
    expect(detail.stops[0].liveKind).toBe('actual')
    expect(detail.stops[1].liveKind).toBe('est')
    expect(detail.stops[1].liveTime).toBe('18:21')
  })

  it('keeps Darwin liveKind when eta/etd were omitted from the payload', () => {
    const detail = normalizeServiceDetail({
      rid: 'G15982',
      uid: 'G15982',
      trainId: '1P83',
      stops: [
        {
          tpl: 'DEWSBRY',
          name: 'Dewsbury',
          crs: 'DEW',
          slot: 'IP',
          pta: '17:59',
          ptd: '18:01',
          wta: '17:59',
          wtd: '18:01',
          wtp: null,
          ata: null,
          atd: null,
          atp: null,
          eta: null,
          etd: null,
          etp: null,
          liveTime: '18:23',
          liveKind: 'est',
        },
      ],
    })
    expect(detail.stops[0].liveKind).toBe('est')
    expect(detail.stops[0].liveTime).toBe('18:23')
    expect(detail.stops[0].etd).toBe('18:23')
  })

  it('marks the unserved remainder of a cancelled service', () => {
    const detail = normalizeServiceDetail({
      rid: '202611036724593',
      cancelled: true,
      cancellation: { source: 'ts', reason: 'TRUST:0002:I8' },
      stops: [
        {
          tpl: 'NTR',
          name: 'Northallerton',
          crs: 'NTR',
          slot: 'IP',
          ata: '12:30',
          atd: null,
          atp: null,
          eta: null,
          etd: null,
          etp: null,
          liveTime: '12:30',
          liveKind: 'actual-arr',
          cancelledAtStop: false,
        },
        {
          tpl: 'LEEDS',
          name: 'Leeds',
          crs: 'LDS',
          slot: 'IP',
          ata: null,
          atd: null,
          atp: null,
          eta: '13:26',
          etd: '13:28',
          etp: null,
          liveTime: '13:28',
          liveKind: 'est',
          cancelledAtStop: false,
        },
      ],
    })
    expect(detail.stops[0].cancelledAtStop).toBe(false)
    expect(detail.stops[1].cancelledAtStop).toBe(true)
    expect(detail.stops[1].cancelReasonAtStop?.reason).toBe('Cancelled')
    expect(detail.stops[1].cancelReasonAtStop?.code).toBe('I8')
  })
})
