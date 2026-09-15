import { buildStationCdnBundleUrl } from '@/services/stationsCdnService'

const MANIFEST_STORAGE_PATH = 'ticket-catalogs/manifest.json'

export type TicketCatalogManifest = {
  version: string
  publishedAt?: string
  source?: string
  collectionsIndex?: string
  files?: Array<{ path: string; bytes: number; sha256: string }>
}

export type TicketCatalogNdjsonDoc = {
  id: string
  data: Record<string, unknown>
}

let cachedManifest: TicketCatalogManifest | null = null
let cachedManifestFetchedAt = 0
const MANIFEST_MEMORY_TTL_MS = 5 * 60 * 1000
let manifestFetchPromise: Promise<TicketCatalogManifest> | null = null

const ndjsonCache = new Map<string, TicketCatalogNdjsonDoc[]>()

export function getTicketCatalogManifestUrl(): string {
  return buildStationCdnBundleUrl(MANIFEST_STORAGE_PATH)
}

export function ticketCatalogCollectionPath(version: string, collectionId: string): string {
  return `ticket-catalogs/${version}/collections/${collectionId}.ndjson.gz`
}

export function parseTicketCatalogNdjson(text: string): TicketCatalogNdjsonDoc[] {
  const rows: TicketCatalogNdjsonDoc[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const obj = parsed as Record<string, unknown>
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : ''
    if (!id) continue
    rows.push({ id, data: obj })
  }
  return rows
}

async function decodePossiblyGzippedText(response: Response): Promise<string> {
  const contentEncoding = response.headers.get('content-encoding')?.toLowerCase() ?? ''
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

  if (
    contentEncoding !== 'gzip' &&
    !contentType.includes('application/json') &&
    !contentType.includes('text/') &&
    typeof DecompressionStream !== 'undefined'
  ) {
    const stream = response.body?.pipeThrough(new DecompressionStream('gzip'))
    if (!stream) throw new Error('Failed to decompress ticket catalogue')
    return new Response(stream).text()
  }

  return response.text()
}

export async function fetchTicketCatalogManifest(options?: {
  force?: boolean
}): Promise<TicketCatalogManifest> {
  const force = options?.force ?? false
  if (
    !force &&
    cachedManifest?.version &&
    Date.now() - cachedManifestFetchedAt < MANIFEST_MEMORY_TTL_MS
  ) {
    return cachedManifest
  }
  if (!force && manifestFetchPromise) return manifestFetchPromise

  manifestFetchPromise = (async () => {
    const response = await fetch(getTicketCatalogManifestUrl(), {
      cache: force ? 'no-cache' : 'default',
    })
    if (!response.ok) {
      throw new Error(`Ticket catalogue manifest failed (${response.status})`)
    }
    const manifest = (await response.json()) as TicketCatalogManifest
    if (!manifest?.version) {
      throw new Error('Ticket catalogue manifest has no version')
    }
    cachedManifest = manifest
    cachedManifestFetchedAt = Date.now()
    return manifest
  })()

  try {
    return await manifestFetchPromise
  } finally {
    manifestFetchPromise = null
  }
}

export async function fetchTicketCatalogNdjson(
  collectionId: string,
  options?: { force?: boolean }
): Promise<TicketCatalogNdjsonDoc[]> {
  const force = options?.force ?? false
  if (!force) {
    const hit = ndjsonCache.get(collectionId)
    if (hit) return hit
  }

  const manifest = await fetchTicketCatalogManifest({ force })
  const path = ticketCatalogCollectionPath(manifest.version, collectionId)
  const response = await fetch(buildStationCdnBundleUrl(path))
  if (!response.ok) {
    throw new Error(`Ticket catalogue ${collectionId} failed (${response.status})`)
  }
  const text = await decodePossiblyGzippedText(response)
  const rows = parseTicketCatalogNdjson(text)
  ndjsonCache.set(collectionId, rows)
  return rows
}

export function invalidateTicketCatalogCache(): void {
  cachedManifest = null
  cachedManifestFetchedAt = 0
  manifestFetchPromise = null
  ndjsonCache.clear()
}
