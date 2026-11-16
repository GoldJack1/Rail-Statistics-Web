import { describe, expect, it } from 'vitest'
import { classSlug } from './UnitDiagram'

const slug = (fleetId: string | null, unitId: string | null = null) =>
  classSlug({ fleetId, unitId, vehicleCount: 1 })

describe('classSlug', () => {
  it('reads the class from a plain fleet id', () => {
    expect(slug('800/1')).toBe('800')
    expect(slug('444/0')).toBe('444')
    expect(slug('158')).toBe('158')
  })

  it('reads the class from a zero-padded fleet id', () => {
    expect(slug('087/2')).toBe('87')
    expect(slug('005/0')).toBe('5')
  })

  it('reads class 91 from the locomotive + coach fleet and maps it to the IC225 art', () => {
    expect(slug('G91/M')).toBe('ic225')
  })

  it('finds the IC225 art from an NL set number when a board has no fleet id', () => {
    expect(slug(null, 'NL16')).toBe('ic225')
    expect(slug(null, 'nl08')).toBe('ic225')
  })

  it('reads the class from a six-digit unit number', () => {
    expect(slug(null, '800033')).toBe('800')
    expect(slug(null, '399201')).toBe('399')
  })

  it('maps class 555 to the Tyne and Wear slug', () => {
    expect(slug('555/0')).toBe('t-w-555')
    expect(slug(null, '555001')).toBe('t-w-555')
  })

  it('returns null when nothing identifies a class', () => {
    expect(slug(null, null)).toBeNull()
    expect(slug(null, 'ABC')).toBeNull()
  })
})
