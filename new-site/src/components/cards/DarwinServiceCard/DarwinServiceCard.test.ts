import { describe, expect, it } from 'vitest'
import { delayedBoardStatusLabel } from '@/components/cards/DarwinServiceCard/DarwinServiceCard'
import type { DepartureRow } from '@/types/darwin'

function row(partial: Partial<DepartureRow>): DepartureRow {
  return {
    rid: 'r',
    uid: 'u',
    trainId: '1A00',
    toc: 'NT',
    tocName: 'Northern',
    origin: 'LDS',
    originName: 'Leeds',
    originCrs: 'LDS',
    destination: 'YRK',
    destinationName: 'York',
    destinationCrs: 'YRK',
    scheduledTime: '19:00',
    liveTime: '19:18',
    liveKind: 'est',
    platform: '1',
    cancelled: false,
    delayMinutes: 18,
    serviceType: 'passenger',
    isPassing: false,
    movement: 'departure',
    ...partial,
  } as DepartureRow
}

describe('delayedBoardStatusLabel', () => {
  it('uses Expected on live boards', () => {
    expect(delayedBoardStatusLabel(row({}), false)).toBe('Delayed\u00a0|\u00a0Expected at 19:18')
  })

  it('uses Was Delayed | Departed at on past boards', () => {
    expect(delayedBoardStatusLabel(row({}), true)).toBe('Was Delayed\u00a0|\u00a0Departed at 19:18')
  })

  it('uses Was Delayed | Arrived at for terminating / arrival rows', () => {
    expect(delayedBoardStatusLabel(row({ movement: 'arrival', liveKind: 'est-arr' }), true)).toBe(
      'Was Delayed\u00a0|\u00a0Arrived at 19:18',
    )
  })
})
