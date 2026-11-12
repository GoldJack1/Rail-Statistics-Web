import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchServiceRoute, watchServiceRoute } from './serviceRoute'

const line = { path: [[51.5, -0.1], [51.6, -0.2]], complete: true, booked: {}, platforms: {}, marks: {} }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('fetchServiceRoute', () => {
  it('asks again after a dropped connection and a server error', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(reply({}, 500))
      .mockResolvedValueOnce(reply(line))
    vi.stubGlobal('fetch', fetchMock)
    const route = await fetchServiceRoute('{"stops":[]}', false, new AbortController().signal)
    expect(route?.path).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after repeated failures', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply({}, 500))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchServiceRoute('{"stops":[]}', false, new AbortController().signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps asking while the line is pending', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply({ pending: true }, 200))
      .mockResolvedValueOnce(reply({}, 504))
      .mockResolvedValueOnce(reply(line))
    vi.stubGlobal('fetch', fetchMock)
    const route = await fetchServiceRoute('{"stops":[]}', false, new AbortController().signal)
    expect(route?.complete).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('watchServiceRoute', () => {
  it('shares one line between a page that started it and a page that joins later', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(line))
    vi.stubGlobal('fetch', fetchMock)
    const request = '{"toc":"XX","stops":[1]}'
    const seen: Array<boolean> = []
    const stop = watchServiceRoute(request, (_route, final) => seen.push(final))
    await vi.waitFor(() => expect(seen).toContain(true))
    stop()
    const calls = fetchMock.mock.calls.length
    const late = vi.fn()
    watchServiceRoute(request, late)
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ complete: true }), true)
    expect(fetchMock.mock.calls.length).toBe(calls)
  })
})
