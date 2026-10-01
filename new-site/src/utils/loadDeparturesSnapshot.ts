import type { DeparturesSnapshot } from '@/types/darwin'
import { resolveDarwinApiOrigin } from '@/utils/darwinApiOrigin'
import { normalizeDeparturesSnapshot } from '@/utils/normalizeRailCore'

export async function loadDeparturesSnapshot(opts: {
  code: string
  hours: number
  date?: string
  at?: string
  cis?: boolean
}): Promise<DeparturesSnapshot | null> {
  const code = opts.code.trim().toUpperCase()
  if (!code) return null
  const url = new URL(`/api/departures/${encodeURIComponent(code)}`, resolveDarwinApiOrigin())
  url.searchParams.set('hours', String(opts.hours))
  if (opts.date) url.searchParams.set('date', opts.date)
  if (opts.at) url.searchParams.set('at', opts.at)
  if (opts.cis) url.searchParams.set('passengers', '1')
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = (process.env.DARWIN_API_KEY || '').trim()
  if (apiKey) headers['X-API-Key'] = apiKey
  try {
    const res = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) return null
    return normalizeDeparturesSnapshot(await res.json(), code)
  } catch {
    return null
  }
}
