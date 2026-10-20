import { describe, expect, it } from 'vitest'
import {
  getContrastingTextColor,
  getTocOperatorChipColors,
  mapTocOperatorDoc,
  resolveTocRouteColor,
  resolveNreTocCodeDisplayName,
  resolveTocOperatorDisplayName,
} from '@/utils/tocOperatorMap'

describe('mapTocOperatorDoc', () => {
  it('maps Firebase toc_operators fields', () => {
    expect(
      mapTocOperatorDoc('avanti', {
        name: 'Avanti West Coast',
        colorHex: '#004354',
        operatorregion: 'England, Scotland, Wales',
        operatortype: 'Rail Operator',
      })
    ).toEqual({
      id: 'avanti',
      name: 'Avanti West Coast',
      colorHex: '#004354',
      operatorRegion: 'England, Scotland, Wales',
      operatorType: 'Rail Operator',
    })
  })
})

describe('getTocOperatorChipColors', () => {
  const operators = [
    {
      id: 'avanti',
      name: 'Avanti West Coast',
      colorHex: '#004354',
      operatorRegion: null,
      operatorType: null,
    },
  ]

  it('uses operator colour and light text on dark backgrounds', () => {
    expect(getTocOperatorChipColors(operators, 'Avanti West Coast')).toEqual({
      bg: '#004354',
      text: '#ffffff',
    })
  })

  it('falls back when TOC is unknown', () => {
    expect(getTocOperatorChipColors(operators, 'Unknown TOC').bg).toBe('#64748b')
  })

  it('resolves a route colour from the TOC name or code', () => {
    expect(resolveTocRouteColor(operators, 'VT', 'Avanti West Coast')).toBe('#004354')
    expect(resolveTocRouteColor(operators, 'VT', null)).toBe('#004354')
    expect(resolveTocRouteColor([], 'ZZ', 'Unknown TOC')).toBe('#64748b')
  })
})

describe('resolveTocOperatorDisplayName', () => {
  const operators = [
    {
      id: 'avanti',
      name: 'Avanti West Coast',
      colorHex: '#004354',
      operatorRegion: null,
      operatorType: null,
    },
  ]

  it('returns canonical Firebase name on case-insensitive match', () => {
    expect(resolveTocOperatorDisplayName(operators, 'avanti west coast')).toBe(
      'Avanti West Coast'
    )
  })

  it('matches by Firestore document id', () => {
    expect(resolveTocOperatorDisplayName(operators, 'avanti')).toBe('Avanti West Coast')
  })
})

describe('resolveNreTocCodeDisplayName', () => {
  const operators = [
    {
      id: 'Southeastern',
      name: 'Southeastern',
      colorHex: '#389cff',
      operatorRegion: null,
      operatorType: null,
    },
  ]

  it('resolves NRE two-letter codes to catalog names', () => {
    expect(resolveNreTocCodeDisplayName(operators, 'SE')).toBe('Southeastern')
  })

  it('returns the code when unknown', () => {
    expect(resolveNreTocCodeDisplayName(operators, 'ZZ')).toBe('ZZ')
  })
})

describe('getContrastingTextColor', () => {
  it('picks dark text on light backgrounds', () => {
    expect(getContrastingTextColor('#ecb739')).toBe('#1a1a1a')
  })
})
