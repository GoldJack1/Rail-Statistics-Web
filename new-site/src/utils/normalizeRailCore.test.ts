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
})
