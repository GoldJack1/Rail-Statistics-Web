import { describe, expect, it } from 'vitest'
import {
  decodeSnapshotFromJsonBytes,
  encodeSnapshotToJsonBytes,
  normalizeVaultDateString,
  plaintextNeedsIosCompatibilityRewrite,
  toSwiftCompatibleIso8601,
} from '@/services/accountSnapshotCodec'
import { emptySnapshot } from '@/services/accountModels'
import { bytesToBase64 } from '@/services/vaultCrypto'

describe('accountSnapshotCodec iOS parity', () => {
  it('normalizes date-only and fractional ISO dates', () => {
    expect(normalizeVaultDateString('2026-09-05')).toBe('2026-09-05T00:00:00Z')
    expect(toSwiftCompatibleIso8601(new Date('2026-09-05T12:34:56.789Z'))).toBe(
      '2026-09-05T12:34:56Z'
    )
  })

  it('encodes ticket fields as base64 Data (empty = W10=)', () => {
    const snap = emptySnapshot(new Date('2026-09-05T12:00:00.000Z'))
    snap.stationsLocal = {
      'abc|GBNR': {
        id: 'abc',
        isVisited: true,
        visitedDates: ['2026-09-05'],
        isFavorite: false,
        notes: null,
      },
    }
    const encoded = encodeSnapshotToJsonBytes(snap)
    const raw = JSON.parse(new TextDecoder().decode(encoded)) as Record<string, unknown>
    expect(raw.updatedAt).toBe('2026-09-05T12:00:00Z')
    expect(raw.singlesJSON).toBe(bytesToBase64(new TextEncoder().encode('[]')))
    expect(raw.singlesJSON).toBe('W10=')
    expect(typeof raw.singlesJSON).toBe('string')
    expect(Array.isArray(raw.singlesJSON)).toBe(false)
    const station = (raw.stationsLocal as Record<string, { visitedDates: string[] }>)['abc|GBNR']
    expect(station.visitedDates[0]).toBe('2026-09-05T00:00:00Z')
    expect(plaintextNeedsIosCompatibilityRewrite(encoded)).toBe(false)
  })

  it('flags date-only visitedDates and raw ticket arrays for rewrite', () => {
    const bad = new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 2,
        updatedAt: '2026-09-05T12:00:00Z',
        stationsLocal: {
          'x|GBNR': { id: 'x', isVisited: true, visitedDates: ['2026-09-05'], isFavorite: false },
        },
        singlesJSON: [],
        returnsJSON: 'W10=',
        rangersJSON: 'W10=',
        roversJSON: 'W10=',
        travelcardsJSON: 'W10=',
        dpaygJSON: 'W10=',
        devPreferences: {
          enableDevMode: false,
          overrideStandardPremium: false,
          overrideFirstClass: false,
        },
      })
    )
    expect(plaintextNeedsIosCompatibilityRewrite(bad)).toBe(true)
  })

  it('round-trips snapshot bytes and ignores cloud devPreferences on decode', () => {
    const snap = emptySnapshot(new Date('2026-03-01T08:00:00Z'))
    const encoded = encodeSnapshotToJsonBytes(snap, {
      passThroughDevPreferences: {
        enableDevMode: true,
        overrideStandardPremium: true,
        overrideFirstClass: false,
      },
    })
    const raw = JSON.parse(new TextDecoder().decode(encoded)) as {
      devPreferences: { enableDevMode: boolean }
    }
    expect(raw.devPreferences.enableDevMode).toBe(true)
    const decoded = decodeSnapshotFromJsonBytes(encoded)
    // Web model ignores prefs — always empty defaults after decode.
    expect(decoded.devPreferences.enableDevMode).toBe(false)
    expect(decoded.devPreferences.overrideStandardPremium).toBe(false)
    expect(new TextDecoder().decode(decoded.singlesJSON)).toBe('[]')
  })
})
