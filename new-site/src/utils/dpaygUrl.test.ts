import { describe, expect, it } from 'vitest'

import {
  buildDpaygFaresPath,
  buildDpaygOdSlug,
  buildFaresHubPath,
  findSchemeByAreaSlug,
  getDpaygAreaSlug,
  hubPathForSearchBase,
  isFaresHubSectionId,
  parseDpaygOdSlug,
} from './dpaygUrl'

describe('dpaygUrl', () => {
  it('slugifies area labels including en dashes', () => {
    expect(
      getDpaygAreaSlug({
        id: 'sheffield_doncaster',
        name: 'Sheffield Doncaster Trial',
        shortName: 'Sheffield–Doncaster',
      })
    ).toBe('sheffield-doncaster')
  })

  it('resolves a scheme by area slug', () => {
    const schemes = [
      {
        id: 'a',
        name: 'Other',
        shortName: 'EMR Midlands',
      },
      {
        id: 'b',
        name: 'Sheffield Doncaster',
        shortName: 'Sheffield–Doncaster',
      },
      {
        id: 'emr-midlands',
        name: 'Derby Nottingham Leicester',
        shortName: '',
      },
    ] as const
    expect(findSchemeByAreaSlug(schemes as never, 'sheffield-doncaster')?.id).toBe('b')
    expect(findSchemeByAreaSlug(schemes as never, 'emr-midlands')?.id).toBe('a')
    expect(findSchemeByAreaSlug(schemes as never, 'emr-midlands')?.shortName).toBe('EMR Midlands')
    // Falls back to document id when shortName is empty.
    expect(
      findSchemeByAreaSlug(
        [{ id: 'emr-midlands', name: 'Midlands', shortName: '' }] as never,
        'emr-midlands'
      )?.id
    ).toBe('emr-midlands')
    expect(findSchemeByAreaSlug(schemes as never, 'missing')).toBeNull()
  })

  it('builds and parses CRS od segments', () => {
    expect(buildDpaygOdSlug('SHF', 'MHS')).toBe('shf-mhs')
    expect(parseDpaygOdSlug('shf-mhs')).toEqual({ originCrs: 'SHF', destCrs: 'MHS' })
    expect(parseDpaygOdSlug('SHF-MHS')).toEqual({ originCrs: 'SHF', destCrs: 'MHS' })
    expect(parseDpaygOdSlug('shf-shf')).toBeNull()
    expect(parseDpaygOdSlug('not-a-pair')).toBeNull()
    expect(buildDpaygOdSlug('910GPADTON', '940GZZLUEUS')).toBe('910gpadton~940gzzlueus')
    expect(parseDpaygOdSlug('910gpadton~940gzzlueus')).toEqual({
      originCrs: '910GPADTON',
      destCrs: '940GZZLUEUS',
    })
  })

  it('builds fare paths', () => {
    expect(buildDpaygFaresPath('sheffield-doncaster')).toBe(
      '/d-payg-fares/sheffield-doncaster'
    )
    expect(buildDpaygFaresPath('sheffield-doncaster', 'shf-mhs')).toBe(
      '/d-payg-fares/sheffield-doncaster/shf-mhs'
    )
  })

  it('maps search bases to the fares hub', () => {
    expect(isFaresHubSectionId('contactless')).toBe(true)
    expect(isFaresHubSectionId('tickets')).toBe(false)
    expect(buildFaresHubPath()).toBe('/fares/contactless')
    expect(buildFaresHubPath('d-payg')).toBe('/fares/d-payg')
    expect(hubPathForSearchBase('/contactless-fares')).toBe('/fares/contactless')
    expect(hubPathForSearchBase('/smartcard-fares')).toBe('/fares/smartcards')
    expect(hubPathForSearchBase('/d-payg-fares')).toBe('/fares/d-payg')
  })
})
