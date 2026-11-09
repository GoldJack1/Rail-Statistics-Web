import { describe, expect, it } from 'vitest'
import { sortStopsByWttTime } from './wttOrder'
import type { WttTimed } from './wttOrder'

function call(name: string, times: Partial<WttTimed>): WttTimed & { name: string } {
  return { name, ...times }
}

describe('sortStopsByWttTime', () => {
  it('keeps a morning portion ahead of the evening terminus', () => {
    const ordered = sortStopsByWttTime([
      call('Bristol', { wtd: '12:32' }),
      call('Edinburgh', { wta: '19:11' }),
      call('Plymouth', { wtd: '10:27' }),
      call('Taunton', { wta: '11:51', wtd: '11:53' }),
      call('Bridgwater', { wtp: '12:01' }),
    ])
    expect(ordered.map((stop) => stop.name)).toEqual([
      'Plymouth',
      'Taunton',
      'Bridgwater',
      'Bristol',
      'Edinburgh',
    ])
  })

  it('keeps a sleeper running past 02:00 in departure order', () => {
    const ordered = sortStopsByWttTime([
      call('Inverness', { wta: '08:37' }),
      call('Preston', { wta: '00:30' }),
      call('Euston', { wtd: '21:15' }),
      call('Edinburgh', { wta: '04:40' }),
    ])
    expect(ordered.map((stop) => stop.name)).toEqual(['Euston', 'Preston', 'Edinburgh', 'Inverness'])
  })
})
