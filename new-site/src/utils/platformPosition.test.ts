import { describe, expect, it } from 'vitest'
import {
  indexPlatformsAt,
  matchPlatforms,
  normalizePlatformRef,
  platformTrackPoints,
  resolvePlatform,
  osmPlatformsFromOverpass,
  parsePlatformQuery,
  platformRefParts,
} from './platformPosition'

describe('normalizePlatformRef', () => {
  it('treats wording and leading zeros as the same platform', () => {
    expect(normalizePlatformRef('Platform 02')).toBe('2')
    expect(normalizePlatformRef('0')).toBe('0')
    expect(normalizePlatformRef('2a')).toBe('2A')
    expect(normalizePlatformRef('15B')).toBe('15B')
    expect(normalizePlatformRef('15')).not.toBe(normalizePlatformRef('15B'))
  })

  it('splits a shared island ref', () => {
    expect(platformRefParts('1;2')).toEqual(['1', '2'])
  })
})

describe('matchPlatforms', () => {
  const leeds = { lat: 53.795, lng: -1.548 }
  const platforms = [
    { lat: 53.7942, lng: -1.5472, refs: ['15'] },
    { lat: 53.796, lng: -1.549, refs: ['15B'] },
    { lat: 53.81, lng: -1.55, refs: ['15'] },
    { lat: 53.7948, lng: -1.5476, refs: ['4'] },
  ]

  it('picks the nearby platform with the exact ref', () => {
    const matched = matchPlatforms(
      [{ id: '28', lat: leeds.lat, lng: leeds.lng, platform: '15' }],
      platforms,
    )
    expect(matched['28']).toEqual({ lat: 53.7942, lng: -1.5472 })
  })

  it('does not use a split platform or a platform at another station', () => {
    expect(matchPlatforms([{ id: '1', ...leeds, platform: '15' }], platforms)['1']?.lat).toBe(53.7942)
    expect(matchPlatforms([{ id: '1', lat: 54.1, lng: -1.5, platform: '15' }], platforms)).toEqual({})
  })

  it('stands between the lettered faces when the timetable has no suffix', () => {
    const matched = matchPlatforms(
      [{ id: '28', lat: 53.7949, lng: -1.54744, platform: '15' }],
      [
        { lat: 53.79397, lng: -1.54861, refs: ['15a'] },
        { lat: 53.79422, lng: -1.5469, refs: ['15b'] },
      ],
    )
    expect(matched['28'].lat).toBeCloseTo((53.79397 + 53.79422) / 2, 5)
    expect(matched['28'].lng).toBeCloseTo((-1.54861 + -1.5469) / 2, 5)
    expect(resolvePlatform({ '15B': { lat: 53.796, lng: -1.549 } }, '15B')).toMatchObject({
      lat: 53.796,
      lng: -1.549,
    })
  })

  it('indexes every ref at the station for the cache', () => {
    expect(indexPlatformsAt(leeds, platforms)).toMatchObject({
      '15': { lat: 53.7942, lng: -1.5472 },
      '15B': { lat: 53.796, lng: -1.549 },
      '4': { lat: 53.7948, lng: -1.5476 },
    })
  })
})

describe('platformTrackPoints', () => {
  it('puts each face on the rail beside it and keeps the buffer end', () => {
    const rail = (lng: number) => ({
      geometry: [
        { lat: 53.405, lng },
        { lat: 53.4062, lng },
      ],
    })
    const box = (lng: number, half = 0.00008) => [
      { lat: 53.4053, lng: lng - half },
      { lat: 53.406, lng: lng - half },
      { lat: 53.406, lng: lng + half },
      { lat: 53.4053, lng: lng + half },
    ]
    const points = platformTrackPoints(
      { lat: 53.4056, lng: -2.1628 },
      [
        { lat: 53.40565, lng: -2.16242, refs: ['0'], geometry: box(-2.16242) },
        { lat: 53.40565, lng: -2.16275, refs: ['1', '2'], geometry: box(-2.16275, 0.00012) },
      ],
      [rail(-2.1625), rail(-2.163)],
      [{ lat: 53.40605, lng: -2.1625 }],
    )
    expect(points['0'].lng).toBeCloseTo(-2.1625, 4)
    expect(points['1'].lng).toBeGreaterThan(points['2'].lng)
    expect(points['0'].bay?.lat).toBeGreaterThan(53.4059)
  })

  it('stands on the stopping mark and ignores a buffer on the next platform', () => {
    const rail = {
      geometry: [
        { lat: 53.5207, lng: -1.1401 },
        { lat: 53.5235, lng: -1.1401 },
      ],
    }
    const platform6 = [
      { lat: 53.52237, lng: -1.1402 },
      { lat: 53.52341, lng: -1.1402 },
      { lat: 53.52341, lng: -1.13995 },
      { lat: 53.52237, lng: -1.13995 },
    ]
    const neighbour = [
      { lat: 53.5224, lng: -1.1412 },
      { lat: 53.5225, lng: -1.1412 },
      { lat: 53.5225, lng: -1.1409 },
      { lat: 53.5224, lng: -1.1409 },
    ]
    const points = platformTrackPoints(
      { lat: 53.5222, lng: -1.1399 },
      [
        { lat: 53.5229, lng: -1.14008, refs: ['6'], geometry: platform6 },
        { lat: 53.52245, lng: -1.14105, refs: ['8'], geometry: neighbour },
      ],
      [rail],
      [{ lat: 53.52245, lng: -1.14095 }],
      [{ lat: 53.52249, lng: -1.1401, refs: ['6'] }],
    )
    expect(points['6'].bay).toBeUndefined()
    expect(points['6'].stand?.lat).toBeCloseTo(53.52249, 4)
  })
})

describe('osmPlatformsFromOverpass', () => {
  it('reads a way centre and its ref', () => {
    expect(
      osmPlatformsFromOverpass({
        elements: [
          { type: 'way', center: { lat: 53.487, lon: -2.243 }, tags: { railway: 'platform', ref: '2' } },
          { type: 'way', center: { lat: 53.488, lon: -2.244 }, tags: { railway: 'platform' } },
        ],
      }),
    ).toEqual([{ lat: 53.487, lng: -2.243, refs: ['2'] }])
  })
})

describe('parsePlatformQuery', () => {
  it('reads id, position and platform', () => {
    expect(parsePlatformQuery('28~53.795~-1.548~15|0~53.48748~-2.2426~Platform%202')).toEqual([
      { id: '28', lat: 53.795, lng: -1.548, platform: '15' },
      { id: '0', lat: 53.48748, lng: -2.2426, platform: 'Platform 2' },
    ])
  })
})
