import { describe, expect, it } from 'vitest'
import { lookupQuaiPlatforms, quaiTrackPoints, type QuaiTrack } from './quaiPlatforms'

const leeds = { lat: 53.7946, lng: -1.548 }
const leedsTracks: QuaiTrack[] = [
  { ref: '11a', lat: 53.794332, lng: -1.547831, on_track: true },
  { ref: '12a', lat: 53.794276, lng: -1.547809, on_track: true },
  { ref: '12b', lat: 53.794276, lng: -1.547809, on_track: true },
  { ref: '12c', lat: 53.794483, lng: -1.545956, on_track: true },
  { ref: '12d', lat: 53.794483, lng: -1.545956, on_track: true },
  { ref: '17', lat: 53.793748, lng: -1.549164, on_track: false },
]

describe('quaiTrackPoints', () => {
  it('stands on a stop position and only places a platform point', () => {
    const points = quaiTrackPoints(leeds, leedsTracks)
    expect(points['12A'].stand).toEqual({ lat: 53.794276, lng: -1.547809 })
    expect(points['17']).toMatchObject({ lat: 53.793748, lng: -1.549164 })
    expect(points['17'].stand).toBeUndefined()
  })

  it('keeps quai numbers, leaving a measured station to the VPS platform file', () => {
    const huddersfield = { lat: 53.64843, lng: -1.78515 }
    const points = quaiTrackPoints(huddersfield, [
      { ref: '1', lat: 53.64833, lng: -1.784869, on_track: true },
      { ref: '4a', lat: 53.649052, lng: -1.784395, on_track: true },
    ])
    expect(points['1'].stand).toEqual({ lat: 53.64833, lng: -1.784869 })
    expect(points['4A'].stand).toEqual({ lat: 53.649052, lng: -1.784395 })
  })
})

describe('lookupQuaiPlatforms', () => {
  it('asks once per station and resolves each booking', async () => {
    const asked: string[] = []
    const coords = await lookupQuaiPlatforms(
      [
        { id: '3', lat: 53.79461, lng: -1.54801, platform: '12' },
        { id: '4', ...leeds, platform: '12C' },
        { id: 'roads5', ...leeds, platform: '*' },
        { id: '9', lat: 51.5, lng: -0.1, platform: '1' },
      ],
      async (lat, lng) => {
        asked.push(`${lat},${lng}`)
        return lat > 53 ? leedsTracks : null
      },
    )
    expect(asked).toHaveLength(2)
    expect(coords['3'].stand).toBeUndefined()
    expect(coords['3'].ends).toEqual([
      [53.794276, -1.547809],
      [53.794483, -1.545956],
    ])
    expect(coords['4'].stand).toEqual([53.794483, -1.545956])
    expect(coords['roads5~17']).toMatchObject({ lat: 53.793748, lng: -1.549164 })
    expect(coords['9']).toBeUndefined()
  })
})
