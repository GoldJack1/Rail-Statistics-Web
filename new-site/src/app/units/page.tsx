'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'

import { BUTWideButton } from '@/components/buttons'
import BUTDDMList from '@/components/buttons/ddm/BUTDDMList'
import { UnitCatalogCard } from '@/components/cards'
import { PageTopHeader, SidebarDropdownSection, SidebarPanel } from '@/components/misc'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { useDebounce } from '@/hooks/useDebounce'
import { isPlausibleUnitOperatingDay, ukCalendarYmd } from '@/utils/unitOperatingDay'
import '@/styles/browsePageLayout.css'
import './UnitsInServicePage.css'

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
  updatedAt?: string
}

type FleetRow = { fleetId: string; unitCount: number }

const PAGE_SIZE = 80
const ALL_DAYS_LABEL = 'All units in collection'

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

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

function catalogQuery(params: {
  q: string
  fleet: string | null
  day: string
  cursor: number
}): string {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.fleet) qs.set('fleet', params.fleet)
  if (params.day && params.day !== 'all') qs.set('day', params.day)
  qs.set('limit', String(PAGE_SIZE))
  if (params.cursor) qs.set('cursor', String(params.cursor))
  return `/api/darwin/units/catalog?${qs.toString()}`
}

const UnitsInServicePage: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = { pathname, search: searchParams.toString() ? `?${searchParams}` : '', state: null as unknown }
  const [units, setUnits] = useState<LeanUnit[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [fleets, setFleets] = useState<FleetRow[]>([])
  const [availableDays, setAvailableDays] = useState<string[]>([])
  const [selectedFleet, setSelectedFleet] = useState<string | null>(null)
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const selectedDay = query.get('unitDay') || 'all'
  const [searchInput, setSearchInput] = useState('')
  const searchNeedle = useDebounce(searchInput.trim().toUpperCase(), 300)
  const [reloadToken, setReloadToken] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  const updateQuery = (updater: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search)
    updater(next)
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  const unitHref = (unitId: string) => {
    const qp = new URLSearchParams()
    if (selectedDay && selectedDay !== 'all') qp.set('unitDay', selectedDay)
    return `/units/${encodeURIComponent(unitId)}${qp.toString() ? `?${qp.toString()}` : ''}`
  }

  const submitSearch = () => {
    const next = searchInput.trim().toUpperCase()
    if (!next) return
    router.push(unitHref(next))
  }

  const dayItems = useMemo(
    () => [ALL_DAYS_LABEL, ...availableDays.map((d) => formatDayLabel(d))],
    [availableDays]
  )

  const selectedDayIndex = useMemo(() => {
    if (selectedDay === 'all') return 0
    const idx = availableDays.indexOf(selectedDay)
    return idx >= 0 ? idx + 1 : 0
  }, [availableDays, selectedDay])

  const classItems = useMemo(
    () => fleets.map((group) => `${group.fleetId} (${group.unitCount})`),
    [fleets]
  )

  const selectedFleetIndex = useMemo(
    () => fleets.findIndex((group) => group.fleetId === selectedFleet),
    [fleets, selectedFleet]
  )

  useEffect(() => {
    const ac = new AbortController()
    fetchDarwin('/api/darwin/units/days', { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ days?: string[] }>
      })
      .then((payload) => {
        const todayYmd = ukCalendarYmd()
        const days = (payload.days || []).filter((d) => isPlausibleUnitOperatingDay(d, todayYmd))
        setAvailableDays(days)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setAvailableDays([])
      })
    return () => ac.abort()
  }, [reloadToken])

  useEffect(() => {
    const ac = new AbortController()
    const qs = selectedDay !== 'all' ? `?day=${encodeURIComponent(selectedDay)}` : ''
    fetchDarwin(`/api/darwin/units/fleets${qs}`, { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ fleets?: FleetRow[] }>
      })
      .then((payload) => {
        const rows = Array.isArray(payload.fleets) ? payload.fleets : []
        setFleets(rows)
        setSelectedFleet((prev) => {
          if (prev && rows.some((r) => r.fleetId === prev)) return prev
          return rows[0]?.fleetId || null
        })
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setFleets([])
      })
    return () => ac.abort()
  }, [reloadToken, selectedDay])

  useEffect(() => {
    const ac = new AbortController()
    setStatus('loading')
    setError(null)
    fetchDarwin(catalogQuery({
      q: searchNeedle,
      fleet: searchNeedle ? null : selectedFleet,
      day: selectedDay,
      cursor: 0,
    }), {
      signal: ac.signal,
    })
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
        setError((e as Error)?.message || 'Could not load units catalog.')
      })
    return () => ac.abort()
  }, [reloadToken, selectedFleet, selectedDay, searchNeedle])

  useEffect(() => {
    if (availableDays.length === 0) {
      if (selectedDay !== 'all') {
        updateQuery((next) => {
          next.delete('unitDay')
        })
      }
      return
    }
    if (selectedDay !== 'all' && !availableDays.includes(selectedDay)) {
      updateQuery((next) => {
        next.delete('unitDay')
      })
    }
  }, [availableDays, selectedDay])

  const loadMore = () => {
    if (nextCursor == null || loadingMore) return
    setLoadingMore(true)
    fetchDarwin(catalogQuery({
      q: searchNeedle,
      fleet: searchNeedle ? null : selectedFleet,
      day: selectedDay,
      cursor: nextCursor,
    }))
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

  return (
    <div className="browse-page units-service-shell">
      <PageTopHeader
        title="Units in service"
        subtitle={status === 'ok' ? 'Browse by class, then pick a unit for details' : 'Loading units catalog...'}
        className="units-service-header"
      />
      <div className="browse-page-content">
          <aside className="browse-sidebar" aria-label="Unit filters">
            <SidebarPanel className="browse-sidebar-panel units-service-sidebar-panel">
              <SidebarDropdownSection title="Search">
                <div className="search-container">
                  <TXTINPBUTIconWideButtonSearch
                    id="units-main-search"
                    icon={<MagnifyingGlass size={16} aria-hidden />}
                    value={searchInput}
                    onChange={setSearchInput}
                    onClear={() => setSearchInput('')}
                    onSubmit={submitSearch}
                    placeholder="Enter unit ID, e.g. 150001"
                    className="search-input-shell"
                    colorVariant="primary"
                    showClear
                  />
                </div>
              </SidebarDropdownSection>

              <SidebarDropdownSection title="Filters">
                <div className="units-filter-group">
                  <h2 className="units-filter-label">Show units for day</h2>
                  <BUTDDMList
                    items={dayItems}
                    filterName="Day"
                    selectionMode="single"
                    selectedPositions={status === 'ok' || availableDays.length > 0 ? [selectedDayIndex] : []}
                    onSelectionChanged={(selectedPositions) => {
                      const idx = selectedPositions[0]
                      if (typeof idx !== 'number') return
                      updateQuery((next) => {
                        if (idx <= 0) next.delete('unitDay')
                        else next.set('unitDay', availableDays[idx - 1])
                      })
                    }}
                    colorVariant="primary"
                    className="units-service-class-ddm"
                  />
                </div>
                <div className="units-filter-group">
                  <h2 className="units-filter-label">Class</h2>
                  <BUTDDMList
                    items={classItems}
                    filterName="Class"
                    selectionMode="single"
                    selectedPositions={selectedFleetIndex >= 0 ? [selectedFleetIndex] : []}
                    onSelectionChanged={(selectedPositions) => {
                      const idx = selectedPositions[0]
                      if (typeof idx !== 'number') return
                      const selected = fleets[idx]
                      if (!selected) return
                      setSelectedFleet(selected.fleetId)
                    }}
                    colorVariant="primary"
                    className="units-service-class-ddm"
                  />
                </div>
                {status === 'ok' && (
                  <p className="units-service-total">
                    Total units: <strong>{total}</strong>
                    {searchNeedle ? ` · ${units.length} loaded` : ''}
                  </p>
                )}
              </SidebarDropdownSection>
            </SidebarPanel>
          </aside>

          <main className="browse-main units-service-main">
            {status === 'loading' && (
              <section className="units-service-message">
                <p>Loading units catalog...</p>
              </section>
            )}

            {status === 'error' && (
              <section className="units-service-message units-service-message--error">
                <h2>Could not load units catalog</h2>
                <p>{error}</p>
                <BUTWideButton
                  width="hug"
                  instantAction
                  colorVariant="primary"
                  onClick={() => setReloadToken((n) => n + 1)}
                >
                  Try again
                </BUTWideButton>
              </section>
            )}

            {status === 'ok' && (
              <>
                <header className="units-service-content-head">
                  <h2>{searchNeedle ? 'Matching units' : selectedFleet ? `Class ${selectedFleet}` : 'Select a class'}</h2>
                  {selectedFleet && !searchNeedle && (
                    <p>
                      {units.length} unit{units.length === 1 ? '' : 's'} loaded
                      {selectedDay !== 'all' ? ` on ${formatDayLabel(selectedDay)}` : ' in collection'}
                    </p>
                  )}
                </header>

                {units.length > 0 ? (
                  <>
                    <div className="units-service-unit-grid">
                      {units.map((unit) => (
                        <UnitCatalogCard
                          key={unit.unitId}
                          unitId={unit.unitId}
                          fleetId={unit.fleetId || selectedFleet || ''}
                          subtitle={unitSubtitle(unit, selectedDay)}
                          onClick={() => router.push(unitHref(unit.unitId))}
                        />
                      ))}
                    </div>
                    {nextCursor != null && (
                      <div className="units-service-load-more">
                        <BUTWideButton
                          width="hug"
                          instantAction
                          colorVariant="primary"
                          onClick={loadMore}
                        >
                          {loadingMore ? 'Loading…' : 'Load more'}
                        </BUTWideButton>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="units-service-muted">
                    {searchNeedle
                      ? 'No units match that ID for the selected day.'
                      : 'No units available in this class.'}
                  </p>
                )}
              </>
            )}
          </main>
      </div>
    </div>
  )
}

export default UnitsInServicePage
