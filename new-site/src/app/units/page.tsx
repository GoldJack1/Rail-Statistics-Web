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
import { peekHotUnitsCatalog } from '@/utils/darwinHotCache'
import { isPlausibleUnitOperatingDay, ukCalendarYmd } from '@/utils/unitOperatingDay'
import '@/styles/browsePageLayout.css'
import './UnitsInServicePage.css'

type UnitCatalogItem = {
  unitId: string
  fleetId: string | null
  endOfDayMileageByDate?: Record<string, number>
  services?: Array<{ start?: string | null }>
}

type UnitCatalogResponse = {
  units: UnitCatalogItem[]
  updatedAt?: string
}

type UnitCatalogCacheEntry = {
  data: UnitCatalogItem[]
  updatedAt?: string
  cachedAtMs: number
}

const unitsCatalogSWRCache = new Map<string, UnitCatalogCacheEntry>()
const CATALOG_CACHE_KEY = 'units-catalog'
const CATALOG_CACHE_MAX_AGE_MS = 5 * 60_000
const ALL_DAYS_LABEL = 'All units in collection'

function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function unitSubtitle(unit: UnitCatalogItem, selectedDay: string): string {
  const mileageMap = unit.endOfDayMileageByDate || {}
  if (selectedDay !== 'all' && selectedDay in mileageMap) {
    const miles = mileageMap[selectedDay]
    if (typeof miles === 'number') {
      return `${miles.toLocaleString('en-GB')} miles on ${formatDayLabel(selectedDay)}`
    }
  }
  const serviceCount = (unit.services || []).length
  if (selectedDay !== 'all') {
    const dayServices = (unit.services || []).filter((svc) => (svc?.start || '').slice(0, 10) === selectedDay)
    return `${dayServices.length} service${dayServices.length === 1 ? '' : 's'} on ${formatDayLabel(selectedDay)}`
  }
  if (serviceCount > 0) return `${serviceCount} service${serviceCount === 1 ? '' : 's'} in collection`
  const latestMileage = Object.entries(mileageMap).sort((a, b) => b[0].localeCompare(a[0]))[0]
  if (latestMileage && typeof latestMileage[1] === 'number') {
    return `${latestMileage[1].toLocaleString('en-GB')} miles · ${formatDayLabel(latestMileage[0])}`
  }
  return 'In collection'
}

const UnitsInServicePage: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = { pathname, search: searchParams.toString() ? `?${searchParams}` : '', state: null as unknown }
  const [catalog, setCatalog] = useState<UnitCatalogItem[]>(() => {
    const hot = peekHotUnitsCatalog()
    return Array.isArray(hot?.units) ? (hot.units as UnitCatalogItem[]) : []
  })
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>(() => (
    peekHotUnitsCatalog()?.units ? 'ok' : 'loading'
  ))
  const [error, setError] = useState<string | null>(null)
  const [selectedFleet, setSelectedFleet] = useState<string | null>(null)
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const selectedDay = query.get('unitDay') || 'all'
  const [searchInput, setSearchInput] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

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

  const availableDays = useMemo(() => {
    const todayYmd = ukCalendarYmd()
    const dates = new Set<string>()
    for (const unit of catalog) {
      for (const d of Object.keys(unit.endOfDayMileageByDate || {})) {
        if (isPlausibleUnitOperatingDay(d, todayYmd)) dates.add(d.slice(0, 10))
      }
      for (const svc of unit.services || []) {
        const start = (svc?.start || '').slice(0, 10)
        if (isPlausibleUnitOperatingDay(start, todayYmd)) dates.add(start)
      }
    }
    return [...dates].sort((a, b) => b.localeCompare(a))
  }, [catalog])

  const dayItems = useMemo(
    () => [ALL_DAYS_LABEL, ...availableDays.map((d) => formatDayLabel(d))],
    [availableDays]
  )

  const selectedDayIndex = useMemo(() => {
    if (selectedDay === 'all') return 0
    const idx = availableDays.indexOf(selectedDay)
    return idx >= 0 ? idx + 1 : 0
  }, [availableDays, selectedDay])

  const dayFilteredCatalog = useMemo(() => {
    const todayYmd = ukCalendarYmd()
    const recentCatalog = catalog.filter((unit) => {
      const mileageDays = Object.keys(unit.endOfDayMileageByDate || {})
      const serviceDays = (unit.services || []).map((svc) => (svc?.start || '').slice(0, 10)).filter(Boolean)
      const allDays = [...mileageDays, ...serviceDays]
      if (allDays.length === 0) return true
      return allDays.some((d) => isPlausibleUnitOperatingDay(d, todayYmd))
    })
    if (selectedDay === 'all') return recentCatalog
    return recentCatalog.filter((unit) => {
      if (unit.endOfDayMileageByDate && selectedDay in unit.endOfDayMileageByDate) return true
      return (unit.services || []).some((svc) => (svc?.start || '').slice(0, 10) === selectedDay)
    })
  }, [catalog, selectedDay])

  const searchNeedle = searchInput.trim().toUpperCase()

  const visibleCatalog = useMemo(() => {
    if (!searchNeedle) return dayFilteredCatalog
    return dayFilteredCatalog.filter((unit) => unit.unitId.toUpperCase().includes(searchNeedle))
  }, [dayFilteredCatalog, searchNeedle])

  const totalUnitsForSelectedDay = dayFilteredCatalog.length

  const groups = useMemo(() => {
    const map = new Map<string, UnitCatalogItem[]>()
    for (const unit of visibleCatalog) {
      const fleetId = (unit.fleetId || 'Unknown').trim() || 'Unknown'
      const existing = map.get(fleetId)
      if (existing) existing.push(unit)
      else map.set(fleetId, [unit])
    }

    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([fleetId, units]) => ({
        fleetId,
        units: units
          .slice()
          .sort((a, b) => a.unitId.localeCompare(b.unitId, undefined, { numeric: true })),
      }))
  }, [visibleCatalog])

  const selectedUnits = useMemo(() => {
    if (!selectedFleet) return []
    return groups.find((g) => g.fleetId === selectedFleet)?.units || []
  }, [groups, selectedFleet])

  const classItems = useMemo(
    () => groups.map((group) => `${group.fleetId} (${group.units.length})`),
    [groups]
  )

  const selectedFleetIndex = useMemo(
    () => groups.findIndex((group) => group.fleetId === selectedFleet),
    [groups, selectedFleet]
  )

  useEffect(() => {
    const ac = new AbortController()
    const cached = unitsCatalogSWRCache.get(CATALOG_CACHE_KEY)
    const hot = peekHotUnitsCatalog()
    if (cached && Date.now() - cached.cachedAtMs <= CATALOG_CACHE_MAX_AGE_MS) {
      setCatalog(cached.data)
      setStatus('ok')
      setError(null)
    } else if (Array.isArray(hot?.units) && hot.units.length > 0) {
      const next = hot.units as UnitCatalogItem[]
      unitsCatalogSWRCache.set(CATALOG_CACHE_KEY, {
        data: next,
        updatedAt: hot.updatedAt,
        cachedAtMs: Date.now(),
      })
      setCatalog(next)
      setStatus('ok')
      setError(null)
    } else {
      setStatus('loading')
      setError(null)
    }
    fetchDarwin('/api/darwin/units/catalog', { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((payload: UnitCatalogResponse) => {
        const next = Array.isArray(payload.units) ? payload.units : []
        unitsCatalogSWRCache.set(CATALOG_CACHE_KEY, {
          data: next,
          updatedAt: payload.updatedAt,
          cachedAtMs: Date.now(),
        })
        setCatalog(next)
        setStatus('ok')
      })
      .catch((e) => {
        if ((e as Error)?.name === 'AbortError') return
        const hasCached = unitsCatalogSWRCache.has(CATALOG_CACHE_KEY)
        if (!hasCached) {
          setStatus('error')
          setError((e as Error)?.message || 'Could not load units catalog.')
        }
      })
    return () => ac.abort()
  }, [reloadToken])

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

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedFleet(null)
      return
    }
    if (!selectedFleet || !groups.some((g) => g.fleetId === selectedFleet)) {
      setSelectedFleet(groups[0].fleetId)
    }
  }, [groups, selectedFleet])

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
                    selectedPositions={status === 'ok' ? [selectedDayIndex] : []}
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
                      const selected = groups[idx]
                      if (!selected) return
                      setSelectedFleet(selected.fleetId)
                    }}
                    colorVariant="primary"
                    className="units-service-class-ddm"
                  />
                </div>
                {status === 'ok' && (
                  <p className="units-service-total">
                    Total units: <strong>{totalUnitsForSelectedDay}</strong>
                    {searchNeedle ? ` · ${visibleCatalog.length} matching` : ''}
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
                  <h2>{selectedFleet ? `Class ${selectedFleet}` : searchNeedle ? 'No matching units' : 'Select a class'}</h2>
                  {selectedFleet && (
                    <p>
                      {selectedUnits.length} unit{selectedUnits.length === 1 ? '' : 's'}
                      {selectedDay !== 'all' ? ` on ${formatDayLabel(selectedDay)}` : ' in collection'}
                    </p>
                  )}
                </header>

                {selectedFleet && selectedUnits.length > 0 ? (
                  <div className="units-service-unit-grid">
                    {selectedUnits.map((unit) => (
                      <UnitCatalogCard
                        key={unit.unitId}
                        unitId={unit.unitId}
                        fleetId={unit.fleetId || selectedFleet}
                        subtitle={unitSubtitle(unit, selectedDay)}
                        onClick={() => router.push(unitHref(unit.unitId))}
                      />
                    ))}
                  </div>
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
