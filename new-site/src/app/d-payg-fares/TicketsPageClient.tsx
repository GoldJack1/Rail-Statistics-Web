'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'

import DpaygTrialTabGroup from '@/components/tickets/DpaygTrialTabGroup'
import TicketFareResults from '@/components/tickets/TicketFareResults'
import TicketsBrowseSidebar from '@/components/tickets/TicketsBrowseSidebar'
import { PageTopHeader } from '@/components/misc'
import { getFareForOd, getScheme, listSchemes } from '@/services/dpaygSchemes'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { matchDpaygStation } from '@/utils/dpaygStationSearch'
import {
  buildDpaygFaresPath,
  buildDpaygOdSlug,
  findSchemeByAreaSlug,
  getDpaygAreaSlug,
  parseDpaygOdSlug,
} from '@/utils/dpaygUrl'

import '@/app/admin/stations/StationsPageRefactored.css'
import '@/app/stations/[network]/[stationSlug]/StationDetailsPage.css'
import './TicketsPage.css'

const TicketsPageClient: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname() ?? '/d-payg-fares'
  const params = useParams()
  const slugParts = useMemo(() => {
    const raw = params.slug
    if (Array.isArray(raw)) return raw.map((part) => String(part).toLowerCase())
    if (typeof raw === 'string' && raw) return [raw.toLowerCase()]
    return [] as string[]
  }, [params.slug])
  const areaSlug = slugParts[0] ?? ''
  const odSlug = slugParts[1] ?? ''
  const urlOd = useMemo(() => (odSlug ? parseDpaygOdSlug(odSlug) : null), [odSlug])

  const [schemes, setSchemes] = useState<DPAYGScheme[]>([])
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const [scheme, setScheme] = useState<DPAYGScheme | null>(null)
  const [loadingSchemes, setLoadingSchemes] = useState(true)
  const [loadingScheme, setLoadingScheme] = useState(false)
  const [loadingFare, setLoadingFare] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [originQuery, setOriginQuery] = useState('')
  const [destQuery, setDestQuery] = useState('')
  const [origin, setOrigin] = useState<DPAYGStation | null>(null)
  const [dest, setDest] = useState<DPAYGStation | null>(null)
  const [fare, setFare] = useState<DPAYGFare | null>(null)
  const [searched, setSearched] = useState(false)

  /** Avoid re-running the URL OD lookup for the same path. */
  const appliedOdPathRef = useRef<string | null>(null)
  /** Area slug from a tab click while the router pathname is still catching up. */
  const pendingAreaSlugRef = useRef<string | null>(null)

  const syncPath = useCallback(
    (nextAreaSlug: string, nextOdSlug?: string | null, mode: 'push' | 'replace' = 'replace') => {
      const nextPath = buildDpaygFaresPath(nextAreaSlug, nextOdSlug)
      if (nextPath === pathname) return
      if (mode === 'push') router.push(nextPath)
      else router.replace(nextPath)
    },
    [pathname, router]
  )

  const resetSearch = useCallback(() => {
    setSearched(false)
    setOrigin(null)
    setDest(null)
    setFare(null)
    setSearchError(null)
    setLoadingFare(false)
  }, [])

  useEffect(() => {
    void (async () => {
      setLoadingSchemes(true)
      setLoadError(null)
      try {
        const rows = await listSchemes()
        const trials = rows.filter((s) => s.status === 'trial' || rows.length <= 3)
        setSchemes(trials.length > 0 ? trials : rows)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load D-PAYG trials.')
      } finally {
        setLoadingSchemes(false)
      }
    })()
  }, [])

  // Resolve / canonicalize area from the URL (or default to the first trial).
  useEffect(() => {
    if (loadingSchemes || schemes.length === 0) return

    // Tab click already chose a scheme; wait until the pathname matches before
    // re-deriving from the (stale) URL — otherwise Midlands snaps back to Sheffield.
    if (pendingAreaSlugRef.current) {
      if (areaSlug === pendingAreaSlugRef.current) {
        pendingAreaSlugRef.current = null
      } else {
        return
      }
    }

    const fromUrl = areaSlug ? findSchemeByAreaSlug(schemes, areaSlug) : null
    const nextScheme = fromUrl ?? schemes[0]
    if (!nextScheme) return

    const canonicalArea = getDpaygAreaSlug(nextScheme)
    if (!areaSlug || !fromUrl || areaSlug !== canonicalArea) {
      // Keep a valid OD only when the area matched; otherwise drop it.
      const keepOd = fromUrl && urlOd ? odSlug : null
      syncPath(canonicalArea, keepOd, 'replace')
    }

    if (selectedSchemeId === nextScheme.id) return

    // Area changed via URL (tabs / back-forward) — clear local search unless OD is present.
    appliedOdPathRef.current = null
    if (!urlOd) {
      resetSearch()
      setOriginQuery('')
      setDestQuery('')
    }
    setSelectedSchemeId(nextScheme.id)
  }, [
    loadingSchemes,
    schemes,
    areaSlug,
    odSlug,
    urlOd,
    syncPath,
    selectedSchemeId,
    resetSearch,
  ])

  // Use the scheme from listSchemes directly — it already includes stations/caps.
  // A second getScheme round-trip was adding lag on tab switches (e.g. Midlands).
  useEffect(() => {
    if (!selectedSchemeId) {
      setScheme(null)
      setLoadingScheme(false)
      return
    }

    const fromList = schemes.find((row) => row.id === selectedSchemeId) ?? null
    if (fromList) {
      setScheme(fromList)
      setLoadingScheme(false)
      setLoadError(null)
      return
    }

    let cancelled = false
    setScheme(null)
    setLoadingScheme(true)
    void (async () => {
      try {
        const loaded = await getScheme(selectedSchemeId)
        if (cancelled) return
        if (loaded) {
          setScheme(loaded)
          setLoadError(null)
        } else {
          setScheme(null)
          setLoadError('Failed to load trial.')
        }
      } catch (err) {
        if (cancelled) return
        setScheme(null)
        setLoadError(err instanceof Error ? err.message : 'Failed to load trial.')
      } finally {
        if (!cancelled) setLoadingScheme(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSchemeId, schemes])

  const handleSchemeChange = (schemeId: string) => {
    if (schemeId === selectedSchemeId) return
    const next = schemes.find((row) => row.id === schemeId)
    if (!next) return
    const nextArea = getDpaygAreaSlug(next)
    pendingAreaSlugRef.current = nextArea
    appliedOdPathRef.current = null
    resetSearch()
    setOriginQuery('')
    setDestQuery('')
    setSelectedSchemeId(schemeId)
    syncPath(nextArea, null, 'push')
  }

  const handleOriginQueryChange = (value: string) => {
    setOriginQuery(value)
    if (!value.trim()) resetSearch()
  }

  const handleDestQueryChange = (value: string) => {
    setDestQuery(value)
    if (!value.trim()) resetSearch()
  }

  const handlePickStation = (field: 'origin' | 'dest', station: DPAYGStation) => {
    const label = `${station.name} (${station.crs})`
    if (field === 'origin') setOriginQuery(label)
    else setDestQuery(label)
  }

  const runSearch = useCallback(
    async (opts?: {
      originCrs?: string
      destCrs?: string
      originQueryOverride?: string
      destQueryOverride?: string
      updateUrl?: boolean
    }) => {
      if (!scheme) return
      setLoadingFare(true)
      setSearchError(null)
      setSearched(true)

      const matchedOrigin = opts?.originCrs
        ? scheme.stations.find((s) => s.crs.toUpperCase() === opts.originCrs!.toUpperCase()) ??
          null
        : matchDpaygStation(scheme.stations, opts?.originQueryOverride ?? originQuery)
      const matchedDest = opts?.destCrs
        ? scheme.stations.find((s) => s.crs.toUpperCase() === opts.destCrs!.toUpperCase()) ?? null
        : matchDpaygStation(scheme.stations, opts?.destQueryOverride ?? destQuery)

      setOrigin(matchedOrigin)
      setDest(matchedDest)

      if (matchedOrigin) {
        setOriginQuery(`${matchedOrigin.name} (${matchedOrigin.crs})`)
      }
      if (matchedDest) {
        setDestQuery(`${matchedDest.name} (${matchedDest.crs})`)
      }

      if (!matchedOrigin || !matchedDest) {
        setFare(null)
        setLoadingFare(false)
        return
      }

      if (matchedOrigin.crs === matchedDest.crs) {
        setSearchError('Origin and destination must be different stations.')
        setFare(null)
        setLoadingFare(false)
        return
      }

      const nextOd = buildDpaygOdSlug(matchedOrigin.crs, matchedDest.crs)
      if (opts?.updateUrl !== false) {
        syncPath(getDpaygAreaSlug(scheme), nextOd, 'replace')
        appliedOdPathRef.current = buildDpaygFaresPath(getDpaygAreaSlug(scheme), nextOd)
      }

      // Dynamic corridors may still have published OD rows — always try the table.
      // If none exist, results UI shows the dynamic/in-app pricing message instead.
      try {
        const loadedFare = await getFareForOd(scheme.id, matchedOrigin.crs, matchedDest.crs)
        setFare(loadedFare)
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Failed to load fare.')
        setFare(null)
      } finally {
        setLoadingFare(false)
      }
    },
    [scheme, originQuery, destQuery, syncPath]
  )

  // Deep-link: /area/shf-mhs → fill fields and look up fare once scheme is ready.
  useEffect(() => {
    if (!scheme || !urlOd || loadingScheme) return
    const pathKey = buildDpaygFaresPath(getDpaygAreaSlug(scheme), odSlug)
    if (appliedOdPathRef.current === pathKey) return
    if (getDpaygAreaSlug(scheme) !== areaSlug && areaSlug) {
      // Wait until area slug is canonicalized to this scheme.
      return
    }
    appliedOdPathRef.current = pathKey
    void runSearch({
      originCrs: urlOd.originCrs,
      destCrs: urlOd.destCrs,
      updateUrl: false,
    })
  }, [scheme, urlOd, odSlug, areaSlug, loadingScheme, runSearch])

  const searchDisabled = useMemo(
    () => !scheme || !originQuery.trim() || !destQuery.trim() || loadingFare,
    [scheme, originQuery, destQuery, loadingFare]
  )

  return (
    <div className="stations-page tickets-page">
      <PageTopHeader
        title="D-PAYG Fares"
        subtitle="Look up Digital Pay As You Go trial fares by corridor."
      />

      <div className="stations-toolbar-band">
        <div className="stations-network-tabs-wrap stations-network-tabs-wrap--toolbar">
          <DpaygTrialTabGroup
            schemes={schemes}
            value={selectedSchemeId}
            onChange={handleSchemeChange}
          />
        </div>
      </div>

      <div className="stations-content">
        <TicketsBrowseSidebar
          scheme={scheme}
          originQuery={originQuery}
          destQuery={destQuery}
          onOriginQueryChange={handleOriginQueryChange}
          onDestQueryChange={handleDestQueryChange}
          onSearch={() => void runSearch()}
          searchDisabled={searchDisabled}
          onPickStation={handlePickStation}
        />

        <TicketFareResults
          scheme={scheme}
          origin={origin}
          dest={dest}
          fare={fare}
          searched={searched}
          error={searchError ?? loadError}
        />
      </div>
    </div>
  )
}

export default TicketsPageClient
