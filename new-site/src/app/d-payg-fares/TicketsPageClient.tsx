'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

import DpaygTrialTabGroup from '@/components/tickets/DpaygTrialTabGroup'
import TicketFareResults from '@/components/tickets/TicketFareResults'
import TicketsBrowseSidebar from '@/components/tickets/TicketsBrowseSidebar'
import { PageTopHeader } from '@/components/misc'
import { getFareForOd, getScheme, listSchemes } from '@/services/dpaygSchemes'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { matchDpaygStation } from '@/utils/dpaygStationSearch'

import '@/app/admin/stations/StationsPageRefactored.css'
import '@/app/stations/[network]/[stationSlug]/StationDetailsPage.css'
import './TicketsPage.css'

/** Minimum time the loading skeleton stays visible so fast cache hits do not flash. */
const MIN_SKELETON_MS = 1500

const TicketsPageClient: React.FC = () => {
  const [schemes, setSchemes] = useState<DPAYGScheme[]>([])
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const [scheme, setScheme] = useState<DPAYGScheme | null>(null)
  const [loadingSchemes, setLoadingSchemes] = useState(true)
  const [loadingScheme, setLoadingScheme] = useState(false)
  const [loadingFare, setLoadingFare] = useState(false)
  const [minSkeletonElapsed, setMinSkeletonElapsed] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [originQuery, setOriginQuery] = useState('')
  const [destQuery, setDestQuery] = useState('')
  const [origin, setOrigin] = useState<DPAYGStation | null>(null)
  const [dest, setDest] = useState<DPAYGStation | null>(null)
  const [fare, setFare] = useState<DPAYGFare | null>(null)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    setMinSkeletonElapsed(false)
    const timer = window.setTimeout(() => setMinSkeletonElapsed(true), MIN_SKELETON_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    void (async () => {
      setLoadingSchemes(true)
      setLoadError(null)
      try {
        const rows = await listSchemes()
        const trials = rows.filter((s) => s.status === 'trial' || rows.length <= 3)
        setSchemes(trials.length > 0 ? trials : rows)
        if (trials[0]?.id) setSelectedSchemeId(trials[0].id)
        else if (rows[0]?.id) setSelectedSchemeId(rows[0].id)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load D-PAYG trials.')
      } finally {
        setLoadingSchemes(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedSchemeId) {
      setScheme(null)
      setLoadingScheme(false)
      return
    }

    let cancelled = false
    setScheme(null)
    setLoadingScheme(true)
    setLoadError(null)

    void (async () => {
      try {
        const loaded = await getScheme(selectedSchemeId)
        if (!cancelled) setScheme(loaded)
      } catch (err) {
        if (!cancelled) {
          setScheme(null)
          setLoadError(err instanceof Error ? err.message : 'Failed to load trial.')
        }
      } finally {
        if (!cancelled) setLoadingScheme(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSchemeId])

  const resetSearch = useCallback(() => {
    setSearched(false)
    setOrigin(null)
    setDest(null)
    setFare(null)
    setSearchError(null)
    setLoadingFare(false)
  }, [])

  const handleSchemeChange = (schemeId: string) => {
    if (schemeId === selectedSchemeId) return
    setSelectedSchemeId(schemeId)
    resetSearch()
    setOriginQuery('')
    setDestQuery('')
  }

  useEffect(() => {
    resetSearch()
    setOriginQuery('')
    setDestQuery('')
  }, [selectedSchemeId, resetSearch])

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

  const runSearch = useCallback(async () => {
    if (!scheme) return
    setLoadingFare(true)
    setSearchError(null)
    setSearched(true)

    const matchedOrigin = matchDpaygStation(scheme.stations, originQuery)
    const matchedDest = matchDpaygStation(scheme.stations, destQuery)
    setOrigin(matchedOrigin)
    setDest(matchedDest)

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

    if (scheme.pricingModel === 'dynamic') {
      setFare(null)
      setLoadingFare(false)
      return
    }

    try {
      const loadedFare = await getFareForOd(scheme.id, matchedOrigin.crs, matchedDest.crs)
      setFare(loadedFare)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to load fare.')
      setFare(null)
    } finally {
      setLoadingFare(false)
    }
  }, [scheme, originQuery, destQuery])

  // Keep skeleton up across the schemes→scheme handoff (avoids an empty-state flash).
  const contentLoading =
    !minSkeletonElapsed ||
    loadingSchemes ||
    loadingScheme ||
    (Boolean(selectedSchemeId) && !scheme && !loadError)
  const searchDisabled = useMemo(
    () => contentLoading || !scheme || !originQuery.trim() || !destQuery.trim(),
    [contentLoading, scheme, originQuery, destQuery]
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
            loading={loadingSchemes || !minSkeletonElapsed}
          />
        </div>
      </div>

      <div className="stations-content">
        <TicketsBrowseSidebar
          scheme={scheme}
          loading={contentLoading}
          originQuery={originQuery}
          destQuery={destQuery}
          onOriginQueryChange={handleOriginQueryChange}
          onDestQueryChange={handleDestQueryChange}
          onSearch={() => void runSearch()}
          searchDisabled={searchDisabled || loadingFare}
          onPickStation={handlePickStation}
        />

        <TicketFareResults
          scheme={scheme}
          origin={origin}
          dest={dest}
          fare={fare}
          searched={searched}
          loading={loadingFare}
          contentLoading={contentLoading}
          error={searchError ?? loadError}
        />
      </div>
    </div>
  )
}

export default TicketsPageClient
