import { describe, expect, it } from 'vitest'
import { formatMilesAndChains, milesAndChainsTitle } from './milesAndChains'

describe('formatMilesAndChains', () => {
  it('writes a running total as miles and chains', () => {
    expect(formatMilesAndChains({ miles: 0 })).toBe('0m 00ch')
    expect(formatMilesAndChains({ miles: 0.2 })).toBe('0m 16ch')
    expect(formatMilesAndChains({ miles: 1 })).toBe('1m 00ch')
    expect(formatMilesAndChains({ miles: 10.1 })).toBe('10m 08ch')
    expect(formatMilesAndChains({ miles: 22 })).toBe('22m 00ch')
    expect(formatMilesAndChains({ miles: 23.68 })).toBe('23m 54ch')
  })

  it('uses metres when the chain would otherwise round the wrong way', () => {
    expect(formatMilesAndChains({ metres: 1609.344 })).toBe('1m 00ch')
    expect(formatMilesAndChains({ metres: 20.1168 })).toBe('0m 01ch')
    expect(formatMilesAndChains({ metres: 990, miles: 0.62 })).toBe('0m 49ch')
  })

  it('describes the total from the origin', () => {
    expect(milesAndChainsTitle({ miles: 0 })).toBe('0 miles 0 chains from origin')
    expect(milesAndChainsTitle({ miles: 1 + 1 / 80 })).toBe('1 mile 1 chain from origin')
    expect(milesAndChainsTitle({ miles: 2 })).toBe('2 miles 0 chains from origin')
  })

  it('ignores a missing distance', () => {
    expect(formatMilesAndChains({})).toBeNull()
    expect(formatMilesAndChains({ miles: null, metres: null })).toBeNull()
    expect(formatMilesAndChains({ miles: Number.NaN })).toBeNull()
    expect(formatMilesAndChains({ miles: -1 })).toBeNull()
  })
})