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

  it('keeps dated historical boards on the same-origin proxy', () => {
    vi.stubGlobal('window', { location: { hostname: 'railstatistics.co.uk' } })
    expect(
      resolveDarwinBrowserUrl('/api/darwin/departures/LDS?hours=24&date=2026-09-27&at=02:00'),
    ).toBe('/api/darwin/departures/LDS?hours=24&date=2026-09-27&at=02:00')
    expect(resolveDarwinBrowserUrl('/api/darwin/history/dates')).toBe('/api/darwin/history/dates')
  })
})

describe('fetchDarwin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('retries HTTP 504 then returns the next response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 504 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = fetchDarwin('/api/darwin/departures/PAD?hours=24&date=2026-09-28&at=02:00')
    await vi.advanceTimersByTimeAsync(1_500)
    const res = await pending
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
