import { describe, expect, it } from 'vitest'
import { parseBoardWindowHours, snapshotMatchesBoardHours } from './boardWindowHours'

describe('parseBoardWindowHours', () => {
  it('defaults live boards to 1 hour', () => {
    expect(parseBoardWindowHours(undefined)).toBe(1)
    expect(parseBoardWindowHours('')).toBe(1)
    expect(parseBoardWindowHours('24')).toBe(1)
    expect(parseBoardWindowHours('2')).toBe(1)
  })

  it('accepts the live window presets', () => {
    expect(parseBoardWindowHours('1')).toBe(1)
    expect(parseBoardWindowHours('3')).toBe(3)
    expect(parseBoardWindowHours('6')).toBe(6)
    expect(parseBoardWindowHours('12')).toBe(12)
  })

  it('uses 24 hours for a full operating day', () => {
    expect(parseBoardWindowHours('1', { fullDay: true })).toBe(24)
  })
})

describe('snapshotMatchesBoardHours', () => {
  it('rejects a 24h snapshot when the UI asked for 1h', () => {
    expect(snapshotMatchesBoardHours({ windowHours: 24 }, 1)).toBe(false)
    expect(snapshotMatchesBoardHours({ windowHours: 1 }, 1)).toBe(true)
  })
})
