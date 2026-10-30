import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '@/types/darwin'
import { arrivalAside, asBookedCall, buildStopStatus, colourDelay, delayMinutesAlong, platformCell, stationArrivalFirst } from './ServiceStopList'

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

describe('asBookedCall', () => {
  it('keeps a station pass as a pass and a working dwell as a stop', () => {
    expect(asBookedCall(passStop({ crs: 'WMB', slot: 'IP', wtp: '21:23½', wta: null, wtd: null, pta: null, ptd: null })).slot).toBe('PP')
    expect(asBookedCall(passStop({ crs: 'EDB', wtp: null, wta: '03:47', wtd: '04:20' })).slot).toBe('IP')
    expect(asBookedCall(passStop({ crs: 'CHF', wtp: null, wta: '16:56', wtd: '16:57' })).slot).toBe('PP')
  })
})

describe('buildStopStatus densify / working passes', () => {
  it('shows Expected + wtp instead of Delayed when carried delay has no live report', () => {
    const status = buildStopStatus(passStop(), 'pass', 6, '17:59', false, null, null, false)
    expect(status.verb).toBe('Expected')
    expect(status.time).toBe('17:59')
    expect(status.delay).toBe('')
  })

  it('marks passed-beyond unreported tipocs as No report', () => {
    const status = buildStopStatus(passStop(), 'pass', 6, '17:59', false, null, null, true)
    expect(status.verb).toBe('No report')
    expect(status.time).toBe('17:59')
  })

  it('shows a calculated junction guess as a normal pass', () => {
    const status = buildStopStatus(
      passStop({
        tpl: 'THHLNWJ',
        crs: null,
        wtp: '13:54',
        atp: '13:55:36',
        liveTime: '13:55:36',
        liveKind: 'actual',
        actualSource: 'inferred',
      }),
      'pass',
      1,
      '13:54',
      false,
    )
    expect(status.verb).toBe('Passed')
    expect(status.time).toBe('13:55:36')
    expect(status.delay).toBe('(+1m L)')
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

describe('calling pattern path and carried delay', () => {
  it('shows a junction line in the platform column, and the path when it differs', () => {
    const junction = passStop({ crs: null, platform: null, line: 'E', path: null })
    expect(platformCell(junction, 'pass')).toBe('E')
    expect(platformCell(passStop({ crs: null, platform: null, line: 'E', path: 'DHU' }), 'pass')).toBe('DHU E')
    expect(platformCell(passStop({ platform: '3', line: 'F' }), 'stop')).toBe('3')
  })

  it('keeps a reported pass with no booked time on the lateness of the stop before it', () => {
    const delays = delayMinutesAlong([
      passStop({ tpl: 'HDRSFLD', slot: 'IP', wtd: '13:46', atd: '13:49', liveKind: 'actual' }),
      passStop({ tpl: 'HUDHESD', crs: null, wtp: null, atp: '13:50:47', liveKind: 'actual' }),
      passStop({ tpl: 'DEIGHTN', wtp: '13:48', atp: '13:52', liveKind: 'actual' }),
    ])
    expect(delays).toEqual([3, 3, 4])
  })

  it('scores arrival and departure separately, and colours an intermediate stop from the departure', () => {
    const leeds = passStop({
      slot: 'IP',
      wtp: null,
      wta: '14:16',
      wtd: '14:23',
      ata: '14:12',
      atd: '14:23',
      liveKind: 'actual',
    })
    expect(colourDelay(leeds, 'stop')).toBe(0)
    expect(stationArrivalFirst(leeds, 'stop')).toEqual({
      time: '14:12',
      delay: '(4m E)',
      departedTime: '14:23',
      departedDelay: '(0 L)',
    })
    const waiting = passStop({
      slot: 'IP',
      wtp: null,
      wta: '14:16',
      wtd: '14:23',
      ata: '14:12',
      atd: null,
      liveKind: 'actual-arr',
    })
    expect(colourDelay(waiting, 'stop')).toBe(-4)
    const waitingOnly = stationArrivalFirst(waiting, 'stop')
    expect(waitingOnly?.departedTime).toBeNull()
    expect(waitingOnly?.time).toBe('14:12')
    const terminus = passStop({
      slot: 'DT',
      wtp: null,
      wta: '15:04',
      wtd: '15:07',
      ata: '15:02',
      atd: '15:09',
      liveKind: 'actual',
    })
    expect(colourDelay(terminus, 'destination')).toBe(-2)
  })
})
