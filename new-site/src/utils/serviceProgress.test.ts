import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '../types/darwin'
import { betweenStationsLabel, inferProgressIndex } from './serviceProgress'

function stop(tpl: string, name: string, slot: string, extra: Partial<ServiceStop> = {}): ServiceStop {
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
    ...extra,
  }
}

const leedsYork = [
  stop('LEEDS', 'Leeds', 'OR', { ptd: '12:02', atd: '12:02', liveKind: 'actual' }),
  stop('CRGT', 'Cross Gates', 'PP', { wtp: '12:06' }),
  stop('GARF', 'Garforth', 'PP', { wtp: '12:10' }),
  stop('EGFT', 'East Garforth', 'PP', { wtp: '12:12' }),
  stop('MCKF', 'Micklefield', 'PP', { wtp: '12:15' }),
  stop('CHFT', 'Church Fenton', 'PP', { wtp: '12:19' }),
  stop('YORK', 'York', 'DT', { pta: '12:25' }),
]

describe('inferProgressIndex', () => {
  it('stays at Leeds until the Cross Gates pass time', () => {
    expect(inferProgressIndex(leedsYork, 12 * 60 + 4)).toBe(0)
  })

  it('steps through passing stations as booked times elapse', () => {
    expect(inferProgressIndex(leedsYork, 12 * 60 + 7)).toBe(1)
    expect(inferProgressIndex(leedsYork, 12 * 60 + 11)).toBe(2)
    expect(inferProgressIndex(leedsYork, 12 * 60 + 20)).toBe(5)
  })

  it('does not invent an arrival at York', () => {
    expect(inferProgressIndex(leedsYork, 12 * 60 + 40)).toBe(5)
  })
})

describe('betweenStationsLabel', () => {
  it('names the next intermediate, not the next public call', () => {
    expect(betweenStationsLabel(leedsYork, 0, (i) => leedsYork[i].name)).toBe('Between Leeds and Cross Gates')
    expect(betweenStationsLabel(leedsYork, 1, (i) => leedsYork[i].name)).toBe('Between Cross Gates and Garforth')
  })

  it('does not add an Arrived-at caption once the train is at the destination', () => {
    const arrived = [
      ...leedsYork.slice(0, -1),
      stop('YORK', 'York', 'DT', { pta: '12:25', ata: '12:26', liveKind: 'actual-arr' }),
    ]
    expect(betweenStationsLabel(arrived, 6, (i) => arrived[i].name)).toBeNull()
  })
})
