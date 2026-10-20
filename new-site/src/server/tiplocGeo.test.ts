import { describe, expect, it } from 'vitest'
import { lookupTiplocCoords } from './tiplocGeo'

describe('lookupTiplocCoords', () => {
  it('returns Manchester Victoria and a junction, and skips unknown codes', () => {
    expect(lookupTiplocCoords(['mncrvic', 'MNCRVEJ', 'NO-SUCH', ''])).toEqual({
      MNCRVIC: [53.48747, -2.2426],
      MNCRVEJ: [53.48876, -2.24055],
    })
  })
})
