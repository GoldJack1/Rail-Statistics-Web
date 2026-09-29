'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import { BUTWideButton } from '@/components/buttons'
import { UnitCatalogCard } from '@/components/cards'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { paramAsString } from '@/utils/nextParams'
import { bandForFleetId, withUnitDay } from '@/utils/unitClassBands'
import { useDebounce } from '@/hooks/useDebounce'
import {
  formatDayLabel,
  UnitsBrowseLayout,
  UnitsBrowseStatus,
  useUnitsBrowse,
} from '../../UnitsBrowseLayout'

type LeanUnit = {
  unitId: string
  fleetId: string | null
  serviceCount?: number
  dayMiles?: number | null
  lastEndOfDayMiles?: number | null
}

type CatalogPage = {
  units: LeanUnit[]
  total?: number
  nextCursor?: number | null
}

const PAGE_SIZE = 100

function unitSubtitle(unit: LeanUnit, selectedDay: string): string {
  if (selectedDay !== 'all' && typeof unit.dayMiles === 'number') {
    return `${unit.dayMiles.toLocaleString('en-GB')} miles on ${formatDayLabel(selectedDay)}`
  }
  const serviceCount = unit.serviceCount || 0
  if (selectedDay !== 'all') {
    return `${serviceCount} service${serviceCount === 1 ? '' : 's'} on ${formatDayLabel(selectedDay)}`
  }
  if (serviceCount > 0) return `${serviceCount} service${serviceCount === 1 ? '' : 's'} in collection`
  if (typeof unit.lastEndOfDayMiles === 'number') {
    return `${unit.lastEndOfDayMiles.toLocaleString('en-GB')} miles`
  }
  return 'In collection'
}

function ClassUnitsMain({ fleetId }: { fleetId: string }) {
  const router = useRouter()
  const { selectedDay, searchInput } = useUnitsBrowse()
  const searchNeedle = useDebounce(searchInput.trim().toUpperCase(), 300)
  const [units, setUnits] = useState<LeanUnit[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const catalogUrl = (cursor: number) => {
    const qs = new URLSearchParams()
    qs.set('fleet', fleetId)
    qs.set('limit', String(PAGE_SIZE))
    if (searchNeedle) qs.set('q', searchNeedle)
    if (selectedDay !== 'all') qs.set('day', selectedDay)
    if (cursor) qs.set('cursor', String(cursor))
    return `/api/darwin/units/catalog?${qs.toString()}`
  }

  useEffect(() => {
    const ac = new AbortController()
    setStatus('loading')
    setError(null)
    fetchDarwin(catalogUrl(0), { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<CatalogPage>
      })
      .then((payload) => {
        setUnits(Array.isArray(payload.units) ? payload.units : [])
        setTotal(payload.total || 0)
        setNextCursor(payload.nextCursor ?? null)
        setStatus('ok')
      })
      .catch((e) => {
        if ((e as Error)?.name === 'AbortError') return
        setStatus('error')
        setError((e as Error)?.message || 'Could not load units.')
      })
    return () => ac.abort()
  }, [fleetId, selectedDay, searchNeedle])

  const loadMore = () => {
    if (nextCursor == null || loadingMore) return
    setLoadingMore(true)
    fetchDarwin(catalogUrl(nextCursor))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<CatalogPage>
      })
      .then((payload) => {
        const extra = Array.isArray(payload.units) ? payload.units : []
        setUnits((prev) => [...prev, ...extra])
        setTotal(payload.total || 0)
        setNextCursor(payload.nextCursor ?? null)
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  if (status !== 'ok') {
    return (
      <UnitsBrowseStatus
        status={status}
        error={error}
        onRetry={() => {
          setStatus('loading')
          setError(null)
          fetchDarwin(catalogUrl(0))
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              return res.json() as Promise<CatalogPage>
            })
            .then((payload) => {
              setUnits(Array.isArray(payload.units) ? payload.units : [])
              setTotal(payload.total || 0)
              setNextCursor(payload.nextCursor ?? null)
              setStatus('ok')
            })
            .catch((e) => {
              setStatus('error')
              setError((e as Error)?.message || 'Could not load units.')
            })
        }}
        loadingLabel="Loading units..."
      />
    )
  }

  return (
    <>
      <header className="units-service-content-head">
        <h2>Class {fleetId}</h2>
        <p>
          {total.toLocaleString('en-GB')} {total === 1 ? 'unit' : 'units'}
          {selectedDay !== 'all' ? ` on ${formatDayLabel(selectedDay)}` : ''}
        </p>
      </header>
      {units.length > 0 ? (
        <>
          <div className="units-service-unit-grid">
            {units.map((unit) => (
              <UnitCatalogCard
                key={unit.unitId}
                unitId={unit.unitId}
                fleetId={unit.fleetId || fleetId}
                subtitle={unitSubtitle(unit, selectedDay)}
                onClick={() => router.push(withUnitDay(`/units/${encodeURIComponent(unit.unitId)}`, selectedDay))}
              />
            ))}
          </div>
          {nextCursor != null && (
            <div className="units-service-load-more">
              <BUTWideButton width="hug" instantAction colorVariant="primary" onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </BUTWideButton>
            </div>
          )}
        </>
      ) : (
        <p className="units-service-muted">No units in this class for the selected day.</p>
      )}
    </>
  )
}

export default function UnitsClassPage() {
  const params = useParams()
  const fleetId = paramAsString(params?.fleetId)
  const band = bandForFleetId(fleetId)

  return (
    <UnitsBrowseLayout
      title={`Class ${fleetId || ''}`}
      subtitle="All units in this class"
      backTo={`/units/range/${encodeURIComponent(band.slug)}`}
      backLabel={`Classes ${band.label}`}
    >
      <ClassUnitsMain fleetId={fleetId} />
    </UnitsBrowseLayout>
  )
}
