import { describe, expect, it } from 'vitest'
import {
  parseDarwinQueryEnv,
  readDarwinQueryEnvFromCookieHeader,
} from './darwinQueryEnvPreference'

describe('darwinQueryEnvPreference', () => {
  it('parses live and dev only', () => {
    expect(parseDarwinQueryEnv('live')).toBe('live')
    expect(parseDarwinQueryEnv('DEV')).toBe('dev')
    expect(parseDarwinQueryEnv('staging')).toBe(null)
  })

  it('reads the preference cookie', () => {
    expect(readDarwinQueryEnvFromCookieHeader('a=1; rs-darwin-query-env=live; b=2')).toBe('live')
    expect(readDarwinQueryEnvFromCookieHeader('')).toBe(null)
  })
})
