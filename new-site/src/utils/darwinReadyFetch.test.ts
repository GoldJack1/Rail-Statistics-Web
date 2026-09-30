import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDarwin, resolveDarwinBrowserUrl } from './darwinReadyFetch'

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

  it('rewrites dated historical boards to the public query host', () => {
    vi.stubGlobal('window', { location: { hostname: 'railstatistics.co.uk' } })
    expect(
      resolveDarwinBrowserUrl('/api/darwin/departures/LDS?hours=24&date=2026-09-27&at=02:00'),
    ).toBe(
      'https://api-raildata.railstatistics.co.uk/api/departures/LDS?hours=24&date=2026-09-27&at=02:00',
    )
    expect(resolveDarwinBrowserUrl('/api/darwin/history/dates')).toBe(
      'https://api-raildata.railstatistics.co.uk/api/history/dates',
    )
  })
})

describe('fetchDarwin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns HTTP 504 without retrying overlay-style gateway timeouts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 504 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchDarwin('/api/darwin/departures/PAD?hours=24&date=2026-09-28&at=02:00')
    expect(res.status).toBe(504)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
