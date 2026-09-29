import { describe, expect, it } from 'vitest'
import { bandForFleetId, fleetInBand, parseBandSlug } from './unitClassBands'

describe('unitClassBands', () => {
  it('maps class 220 into 200–299', () => {
    expect(bandForFleetId('220')).toMatchObject({ slug: '200-299', start: 200, end: 299 })
    expect(bandForFleetId('220/1').slug).toBe('200-299')
    expect(bandForFleetId('Unknown').slug).toBe('other')
  })

  it('filters fleets in a numeric band', () => {
    const band = parseBandSlug('200-299')
    expect(band).not.toBeNull()
    expect(fleetInBand('220', band!)).toBe(true)
    expect(fleetInBand('150', band!)).toBe(false)
    expect(fleetInBand('Unknown', band!)).toBe(false)
  })
})
