import { describe, expect, it } from 'vitest'
import { isRailCoreBoard, normalizeDeparturesSnapshot } from './normalizeRailCore'

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
    expect(snap.services[0].scheduledTime).toBe('10:00')
    expect(snap.services[0].isPassing).toBe(true)
    expect(snap.services[0].actualSource).toBe('darwin')
  })
})
