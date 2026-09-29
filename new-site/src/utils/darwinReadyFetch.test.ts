import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDarwinBrowserUrl } from './darwinReadyFetch'

describe('resolveDarwinBrowserUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps relative proxy URLs on localhost', () => {
    expect(resolveDarwinBrowserUrl('/api/darwin/health')).toBe('/api/darwin/health')
  })

  it('never rewrites admin proxy routes', () => {
    expect(resolveDarwinBrowserUrl('/api/darwin/admin/reload')).toBe('/api/darwin/admin/reload')
  })

  it('rewrites public darwin paths to the Cloudflare API host', () => {
    vi.stubGlobal('window', { location: { hostname: 'railstatistics.co.uk' } })
    expect(resolveDarwinBrowserUrl('/api/darwin/health')).toBe(
      'https://api-raildata.railstatistics.co.uk/api/health',
    )
    expect(resolveDarwinBrowserUrl('/api/darwin/departures/LDS?hours=1')).toBe(
      'https://api-raildata.railstatistics.co.uk/api/departures/LDS?hours=1',
    )
    expect(resolveDarwinBrowserUrl('/api/darwin/admin/reload')).toBe('/api/darwin/admin/reload')
  })
})
