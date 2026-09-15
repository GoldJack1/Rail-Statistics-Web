import { describe, expect, it } from 'vitest'

import { planTfwSouthWalesValleyJourney } from './tfwSouthWalesValleyMapRoutes'

describe('planTfwSouthWalesValleyJourney', () => {
  it('does not rewrite a trip that stays on the valley', () => {
    expect(planTfwSouthWalesValleyJourney('ABA', 'MER')).toBeNull()
    expect(planTfwSouthWalesValleyJourney('PPD', 'TRB')).toBeNull()
  })

  it('routes Aberdare to Cardiff Central via Queen Street and Ninian Park', () => {
    expect(planTfwSouthWalesValleyJourney('ABA', 'CDF')).toEqual({
      routes: [
        ['ABA', 'LLN', 'CYS', 'CDQ', 'CDF'],
        ['ABA', 'RDR', 'DCT', 'FRW', 'WNG', 'NNP', 'CDF'],
      ],
    })
  })

  it('reverses the same pair from Cardiff Central', () => {
    const plan = planTfwSouthWalesValleyJourney('CDF', 'TRB')
    expect(plan?.routes[0]).toEqual(['CDF', 'CDQ', 'CYS', 'LLN', 'TRB'])
    expect(plan?.routes[1]?.[0]).toBe('CDF')
    expect(plan?.routes[1]).toContain('NNP')
    expect(plan?.routes[1]?.at(-1)).toBe('TRB')
  })

  it('keeps a Queen Street-only trip on that approach', () => {
    expect(planTfwSouthWalesValleyJourney('MER', 'CYS')?.routes).toEqual([['MER', 'LLN', 'CYS']])
  })

  it('appends a destination beyond Central to both Cardiff approaches', () => {
    const plan = planTfwSouthWalesValleyJourney('ABA', 'BRY')
    expect(plan?.routes[0]?.at(-1)).toBe('BRY')
    expect(plan?.routes[0]).toEqual(['ABA', 'LLN', 'CYS', 'CDQ', 'CDF', 'BRY'])
    expect(plan?.routes[1]?.slice(-3)).toEqual(['NNP', 'CDF', 'BRY'])
  })
})
