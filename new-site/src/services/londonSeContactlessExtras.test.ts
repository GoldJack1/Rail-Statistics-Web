import { describe, expect, it } from 'vitest'

import {
  addMissingLondonSeStations,
  LONDON_SE_CONTACTLESS_EXTRAS,
} from './londonSeContactlessExtras'

describe('addMissingLondonSeStations', () => {
  it('adds Stansted and the Greater Anglia set when they are absent', () => {
    const merged = addMissingLondonSeStations([
      { crs: '910GEUSTON', name: 'London Euston Rail Station', displayCrs: 'EUS' },
    ])
    expect(merged.some((s) => s.displayCrs === 'SSD')).toBe(true)
    expect(merged.some((s) => s.displayCrs === 'BPA')).toBe(true)
    expect(merged.some((s) => s.crs === '910GEUSTON')).toBe(true)
  })

  it('does not treat London X as missing when X is already present', () => {
    const merged = addMissingLondonSeStations([
      { crs: '910GSTANAIR', name: 'London Stansted Airport Rail Station', displayCrs: 'SSD' },
    ])
    const stansted = merged.filter((s) => s.displayCrs === 'SSD' || /stansted airport/i.test(s.name))
    expect(stansted).toHaveLength(1)
    expect(stansted[0]?.name).toBe('London Stansted Airport Rail Station')
  })

  it('does not add a second row when the naptan already exists under another name', () => {
    const merged = addMissingLondonSeStations([
      { crs: '910GUWRLNGH', name: 'Whyteleafe Rail Station', displayCrs: 'WHY' },
      { crs: '910GWSORAER', name: 'Windsor & Eton Central Rail Station', displayCrs: 'WNC' },
    ])
    expect(merged.filter((s) => s.crs === '910GUWRLNGH')).toHaveLength(1)
    expect(merged.find((s) => s.crs === '910GUWRLNGH')?.name).toBe('Whyteleafe Rail Station')
    expect(merged.filter((s) => s.crs === '910GWSORAER')).toHaveLength(1)
    expect(merged.find((s) => s.crs === '910GWSORAER')?.name).toBe('Windsor & Eton Central Rail Station')
  })

  it('does not remove unrelated stations already in the pack', () => {
    const merged = addMissingLondonSeStations([
      { crs: '910GKINSSTN', name: 'Kings Sutton Rail Station' },
    ])
    expect(merged.some((s) => s.crs === '910GKINSSTN')).toBe(true)
    expect(merged).toHaveLength(LONDON_SE_CONTACTLESS_EXTRAS.length + 1)
  })

  it('still adds National Rail East Croydon when only the tram stop exists', () => {
    const merged = addMissingLondonSeStations([
      { crs: '940GZZCRECR', name: 'East Croydon Tram Stop', displayCrs: 'ECR' },
    ])
    expect(merged.some((s) => s.crs === '910GECROYDN')).toBe(true)
    expect(merged.some((s) => s.crs === '940GZZCRECR')).toBe(true)
  })

  it('still adds Woolwich Arsenal rail when only the DLR stop exists', () => {
    const merged = addMissingLondonSeStations([
      { crs: '940GZZDLWLA', name: 'Woolwich Arsenal DLR Station', displayCrs: 'WWA' },
    ])
    expect(merged.some((s) => s.crs === '910GWOLWCHA')).toBe(true)
    expect(merged.some((s) => s.crs === '940GZZDLWLA')).toBe(true)
  })
})
