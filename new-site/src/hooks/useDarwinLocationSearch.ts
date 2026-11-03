/**
 * Location typeahead against rail-core catalog (`corpus` + `tiploc`, including TOPS/CORPUS imports).
 */
import { useEffect, useState } from 'react'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { publicStationName } from '@/utils/publicStationName'

export type DarwinCatalogLocation = {
  tiploc: string
  crs: string
  name: string
}

/** `station` is a location with a CRS. `other` is junctions, depots, yards and the rest. */
export type DarwinLocationKind = 'station' | 'other'

type LocationsListResponse = {
  locations?: DarwinCatalogLocation[]
}

function asLocation(row: Partial<DarwinCatalogLocation> | null | undefined): DarwinCatalogLocation | null {
  const tiploc = String(row?.tiploc || '').toUpperCase()
  if (!tiploc) return null
  return {
    tiploc,
    crs: String(row?.crs || '').toUpperCase(),
    name: publicStationName(row?.name) || tiploc,
  }
}

export function useDarwinLocationSearch(query: string, kind?: DarwinLocationKind): DarwinCatalogLocation[] {
  const [hits, setHits] = useState<DarwinCatalogLocation[]>([])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ q })
          if (kind) params.set('kind', kind)
          const res = await fetchDarwin(`/api/darwin/locations?${params.toString()}`)
          if (!res.ok) return
          const body = (await res.json()) as LocationsListResponse
          if (cancelled) return
          const rows = (Array.isArray(body.locations) ? body.locations : [])
            .map(asLocation)
            .filter((row): row is DarwinCatalogLocation => Boolean(row))
          const scoped = kind === 'station'
            ? rows.filter((row) => /^[A-Z]{3}$/.test(row.crs))
            : kind === 'other'
              ? rows.filter((row) => !/^[A-Z]{3}$/.test(row.crs))
              : rows
          setHits(scoped)
        } catch {
          if (!cancelled) setHits([])
        }
      })()
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, kind])

  return hits
}

export function useDarwinLocationLookup(code: string): DarwinCatalogLocation | null {
  const [hit, setHit] = useState<DarwinCatalogLocation | null>(null)

  useEffect(() => {
    const key = code.trim().toUpperCase()
    if (!key) {
      setHit(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetchDarwin(`/api/darwin/locations/${encodeURIComponent(key)}`)
        if (!res.ok) return
        const body = asLocation((await res.json()) as DarwinCatalogLocation)
        if (!cancelled) setHit(body)
      } catch {
        if (!cancelled) setHit(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  return hit
}
