import type { DeparturesSnapshot } from '@/types/darwin'
import { resolveDarwinApiOrigin } from '@/utils/darwinApiOrigin'

export async function loadDeparturesSnapshot(opts: {
  code: string
  hours: number
  date?: string
  at?: string
}): Promise<DeparturesSnapshot | null> {
  const code = opts.code.trim().toUpperCase()
  if (!code) return null
  const url = new URL(`/api/departures/${encodeURIComponent(code)}`, resolveDarwinApiOrigin())
  url.searchParams.set('hours', String(opts.hours))
  if (opts.date) url.searchParams.set('date', opts.date)
  if (opts.at) url.searchParams.set('at', opts.at)
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = (process.env.DARWIN_API_KEY || '').trim()
  if (apiKey) headers['X-API-Key'] = apiKey
  try {
    const res = await fetch(url, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    return (await res.json()) as DeparturesSnapshot
  } catch {
    return null
  }
}
