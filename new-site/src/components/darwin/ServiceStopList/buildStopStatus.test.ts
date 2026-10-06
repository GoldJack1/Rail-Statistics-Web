import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '@/types/darwin'
import { buildStopStatus } from './ServiceStopList'

function passStop(overrides: Partial<ServiceStop> = {}): ServiceStop {
  return {
    tpl: 'MIRFILD',
    crs: 'MIR',
    slot: 'PP',
    wtp: '17:59',
    liveKind: 'scheduled',
    liveTime: null,
    ...overrides,
  } as ServiceStop
}

describe('buildStopStatus densify / working passes', () => {
  it('shows Due + wtp instead of Delayed when carried delay has no live report', () => {
    const status = buildStopStatus(passStop(), 'pass', 6, '17:59', false, null, null, false)
    expect(status.verb).toBe('Due')
    expect(status.time).toBe('17:59')
    expect(status.delay).toBe('')
  })

  it('marks passed-beyond unreported tipocs as No report (list omits those rows)', () => {
    const status = buildStopStatus(passStop(), 'pass', 6, '17:59', false, null, null, true)
    expect(status.verb).toBe('No report')
    expect(status.time).toBe('17:59')
  })

  it('still shows Passed when an actual pass time exists', () => {
    const status = buildStopStatus(
      passStop({ atp: '18:01', liveKind: 'actual', liveTime: '18:01' }),
      'pass',
      2,
      '17:59',
      false,
      null,
      null,
      true,
    )
    expect(status.verb).toBe('Passed')
    expect(status.time).toBe('18:01')
  })
})
