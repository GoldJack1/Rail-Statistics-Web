import { describe, expect, it } from 'vitest'
import type { ServiceDetail } from '@/types/darwin'
import { pathedAsText, schedulePanelRows, stopAllowanceNote } from './serviceSchedule'

describe('service schedule panel', () => {
  it('phrases a DMU timing load the way the working timetable does', () => {
    expect(pathedAsText('DMU', '150', '75')).toBe('Pathed as Class 150/153/155/156 DMU at 75mph')
    expect(pathedAsText('EMU', '800', '125')).toBe('Pathed as Class 80x on electric at 125mph')
    expect(pathedAsText('DMU', 'S', null)).toBe('Pathed as DMU')
  })

  it('builds the overview identity rows from the service', () => {
    const data = {
      uid: 'C32529',
      trainId: '2H58',
      trainCat: 'OO',
      powerType: 'DMU',
      timingLoad: '150',
      units: ['158754'],
      schedule: {
        tsc: '21869000',
        headcode: '5908',
        daysLabel: 'SuO - 17/05/2026 to 06/12/2026',
        categoryLabel: 'Ordinary Passenger',
        operatingLabel: 'Great Britain (Network Rail, TPS)',
        seatingLabel: 'Standard class only seating',
        reservationsLabel: 'Reservations available',
        trustId: '172H58MM18',
        activatedAt: '18/10/2026 12:29',
        speed: '75',
        pathedAs: 'Pathed as Class 150/153/155/156 DMU at 75mph',
      },
    } as ServiceDetail
    const text = schedulePanelRows(data).map((row) => row.text)
    expect(text[0]).toBe('UID C32529, identity 2H58')
    expect(text).toContain('TSC 21869000, headcode 5908')
    expect(text).toContain('Operated with 158754')
    expect(text.at(-1)).toBe('Pathed as Class 150/153/155/156 DMU at 75mph')
  })

  it('joins allowance notes', () => {
    expect(stopAllowanceNote({ allowances: ['Pathing allowance 1 minute'] } as ServiceDetail['stops'][number])).toBe(
      'Pathing allowance 1 minute',
    )
  })
})
