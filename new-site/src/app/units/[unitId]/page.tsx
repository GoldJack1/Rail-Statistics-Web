'use client'

import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarBlank, Info, Train, WarningCircle } from '@phosphor-icons/react'

import { BUTWideButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import { TextCard } from '@/components/cards'
import { CarriageMap } from '@/components/darwin/CarriageMap'
import DataLicenceAttribution from '@/components/darwin/DataLicenceAttribution'
import { DarwinDetailsLayout } from '@/components/darwin/DarwinDetailsLayout'
import type { AccountSection } from '@/components/misc/AccountSectionNav/AccountSectionNav'
import StationDetailField from '@/components/models/StationDetails/StationDetailField'
import StationSectionTitle from '@/components/models/StationDetails/StationSectionTitle'
import { useUnitDetail } from '@/hooks/useUnitDetail'
import type { PtacVehicle, ServiceDetail } from '@/types/darwin'
import { paramAsString } from '@/utils/nextParams'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import './UnitLookupPage.css'
import '../../services/[rid]/ServiceDetailPage.css'

type UnitGroup = {
  unitKey: string
  unitId: string | null
  fleetId: string | null
  resourceType: string | null
  unitStatus: string | null
  endOfDayMiles: number | null
  reversed: boolean
  vehicles: PtacVehicle[]
}

type UnitDetailTab = 'overview' | 'service' | 'logs' | 'services'

const UNIT_SECTIONS: AccountSection[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'service', label: 'Latest service', icon: Train },
  { id: 'logs', label: 'Unit logs', icon: WarningCircle },
  { id: 'services', label: 'Services', icon: CalendarBlank },
]
type UnitCatalogItem = {
  unitId: string
  endOfDayMileageByDate?: Record<string, number>
  services?: Array<{ rid?: string | null; start?: string | null }>
}
type UnitCatalogResponse = {
  units: UnitCatalogItem[]
}

function formatDateOnly(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatTimeOnly(dateTime: string | null | undefined): string {
  if (!dateTime) return '--:--'
  const d = new Date(dateTime)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/London',
  })
}

function formatDateFromDateTime(dateTime: string | null | undefined): string {
  if (!dateTime) return 'Unknown date'
  const d = new Date(dateTime)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  })
}

function formatMiles(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return `${Math.round(value).toLocaleString('en-GB')} mi`
}

function formatMilesDelta(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Math.round(value)
  if (rounded === 0) return '0 mi'
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded.toLocaleString('en-GB')} mi`
}

function darwinRidToIsoDate(rid: string | null | undefined): string | null {
  const m = String(rid || '').match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function serviceDetailErrorMessage(status: number, body: { error?: string } | null, date: string | null): string {
  const api = body?.error?.trim()
  if (status === 404 && api?.startsWith('no historical data')) {
    return `No saved Darwin snapshot for ${date || 'that day'}. Only the live timetable is loaded, so older unit workings cannot show a calling pattern.`
  }
  if (status === 404 && (api?.startsWith('rid not found') || !api)) {
    return 'This working is not in today’s live Darwin timetable (often a leftover from an older day).'
  }
  return api || `HTTP ${status}`
}

function getTodayUkDateYmd(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date())
  const day = parts.find((p) => p.type === 'day')?.value || '01'
  const month = parts.find((p) => p.type === 'month')?.value || '01'
  const year = parts.find((p) => p.type === 'year')?.value || '1970'
  return `${year}-${month}-${day}`
}

const UnitLookupPage: React.FC = () => {
  const unitId = paramAsString(useParams().unitId).trim().toUpperCase()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = { pathname, search: searchParams.toString() ? `?${searchParams}` : '', state: null as unknown }
  const [activeTab, setActiveTab] = useState<UnitDetailTab>('overview')
  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const todayUk = useMemo(() => getTodayUkDateYmd(), [])
  const hasUnitDayQuery = query.has('unitDay')
  const selectedDay = query.get('unitDay') || todayUk
  const { status, data, error } = useUnitDetail({ unitId })
  const [latestService, setLatestService] = useState<ServiceDetail | null>(null)
  const [latestServiceError, setLatestServiceError] = useState<string | null>(null)
  const [snapshotMileageByDay, setSnapshotMileageByDay] = useState<Record<string, number>>({})
  const [catalogUnit, setCatalogUnit] = useState<UnitCatalogItem | null>(null)
  const snapshotPrefetchAttemptedDaysRef = useRef<Set<string>>(new Set())

  const updateQuery = (updater: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search)
    updater(next)
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  const title = unitId ? `Unit ${unitId}` : 'Unit lookup'
  const subtitle = useMemo(() => {
    if (status === 'loading') return 'Loading PTAC unit detail...'
    if (status === 'ok') return 'Live PTAC-backed unit view'
    if (status === 'not-found') return 'Unit not found'
    if (status === 'error') return error || 'Unable to load unit detail'
    return 'Search by unit ID (e.g. 150001, 801207)'
  }, [status, error])

  const latestServiceUnitGroups = useMemo<UnitGroup[]>(() => {
    if (!latestService?.consist?.allocations?.length) return []
    const map = new Map<string, UnitGroup>()
    latestService.consist.allocations.forEach((a) => {
      ;(a.resourceGroups || []).forEach((g, groupIdx) => {
        const unitKey = `unit-${g.unitId || 'unknown'}-${g.fleetId || 'unknown'}-${groupIdx}`
        const existing = map.get(unitKey)
        if (!existing) {
          map.set(unitKey, {
            unitKey,
            unitId: g.unitId || null,
            fleetId: g.fleetId || null,
            resourceType: g.typeOfResourceLabel || g.typeOfResource || null,
            unitStatus: g.status || null,
            endOfDayMiles: g.endOfDayMiles ?? null,
            reversed: !!a.reversed,
            vehicles: [...(g.vehicles || [])],
          })
          return
        }
        const seen = new Set(existing.vehicles.map((v) => `${v.vehicleId || ''}-${v.position ?? ''}`))
        for (const v of g.vehicles || []) {
          const vk = `${v.vehicleId || ''}-${v.position ?? ''}`
          if (!seen.has(vk)) {
            existing.vehicles.push(v)
            seen.add(vk)
          }
        }
      })
    })
    return [...map.values()]
  }, [latestService])

  const latestServiceLogsByVehicle = useMemo(() => {
    const rows: Array<{
      key: string
      unitId: string
      vehicleId: string
      logCount: number
      defects: Array<{ code?: string | null; description?: string | null }>
    }> = []
    latestServiceUnitGroups.forEach((g) => {
      g.vehicles
        .slice()
        .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
        .forEach((v, idx) => {
          const count = (v.defects || []).length
          rows.push({
            key: `${g.unitKey}-${v.vehicleId || idx}`,
            unitId: g.unitId || 'Unknown',
            vehicleId: v.vehicleId || `Vehicle ${idx + 1}`,
            logCount: count,
            defects: v.defects || [],
          })
        })
    })
    return rows
  }, [latestServiceUnitGroups])

  const availableDays = useMemo(() => {
    const fromDetailServices = (data?.services || [])
      .map((svc) => (svc.start ? svc.start.slice(0, 10) : null))
      .filter((d): d is string => !!d)
    const fromDetailMileage = Object.keys(data?.endOfDayMileageByDate || {})
    const fromCatalogServices = (catalogUnit?.services || [])
      .map((svc) => (svc.start ? svc.start.slice(0, 10) : null))
      .filter((d): d is string => !!d)
    const fromCatalogMileage = Object.keys(catalogUnit?.endOfDayMileageByDate || {})
    return Array.from(
      new Set([
        ...fromDetailServices,
        ...fromDetailMileage,
        ...fromCatalogServices,
        ...fromCatalogMileage,
      ])
    ).sort((a, b) => b.localeCompare(a))
  }, [data, catalogUnit])

  const filteredServices = useMemo(() => {
    if (!data) return []
    if (selectedDay === 'all') return data.services
    return data.services.filter((svc) => (svc.start || '').slice(0, 10) === selectedDay)
  }, [data, selectedDay])

  const latestRidByDay = useMemo(() => {
    const byDay = new Map<string, string>()
    const allServices = [
      ...(data?.services || []),
      ...(catalogUnit?.services || []).map((svc) => ({
        rid: svc.rid || null,
        start: svc.start || null,
      })),
    ]
    const servicesByNewest = allServices
      .slice()
      .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
    for (const svc of servicesByNewest) {
      const day = (svc.start || '').slice(0, 10)
      if (!day || !svc.rid) continue
      if (!byDay.has(day)) byDay.set(day, svc.rid)
    }
    return byDay
  }, [data?.services, catalogUnit?.services])

  const latestRidForSelection = useMemo(() => {
    if (!data) return null
    if (selectedDay === 'all') return data.lastSeenRid
    const byNewest = filteredServices
      .slice()
      .sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')))
    return byNewest[0]?.rid || null
  }, [data, filteredServices, selectedDay])

  const shouldFetchLatestService = useMemo(() => {
    if (!latestRidForSelection) return false
    return activeTab === 'service' || activeTab === 'logs'
  }, [latestRidForSelection, activeTab])

  const mileageRows = useMemo(() => {
    const merged = {
      ...(catalogUnit?.endOfDayMileageByDate || {}),
      ...(data?.endOfDayMileageByDate || {}),
    }
    return Object.entries(merged)
      .filter(([day, miles]) => !!day && typeof miles === 'number' && Number.isFinite(miles))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, miles]) => ({ day, miles }))
  }, [data?.endOfDayMileageByDate, catalogUnit?.endOfDayMileageByDate])

  const snapshotMileageFallback = useMemo(() => {
    if (!data) return null
    const matching = latestServiceUnitGroups
      .filter((group) => (group.unitId || '').trim().toUpperCase() === data.unitId.trim().toUpperCase())
      .map((group) => group.endOfDayMiles)
      .filter((miles): miles is number => typeof miles === 'number' && Number.isFinite(miles))
    if (matching.length === 0) return null
    return matching[0]
  }, [data, latestServiceUnitGroups])

  const mileageRowsWithSnapshot = useMemo(() => {
    const byDay = new Map<string, { day: string; miles: number; source: 'catalog' | 'snapshot' }>()
    for (const row of mileageRows) {
      byDay.set(row.day, { ...row, source: 'catalog' })
    }
    for (const [day, miles] of Object.entries(snapshotMileageByDay)) {
      if (!day || typeof miles !== 'number' || !Number.isFinite(miles)) continue
      if (!byDay.has(day)) byDay.set(day, { day, miles, source: 'snapshot' })
    }
    if (
      selectedDay !== 'all' &&
      snapshotMileageFallback != null &&
      !byDay.has(selectedDay)
    ) {
      byDay.set(selectedDay, {
        day: selectedDay,
        miles: snapshotMileageFallback,
        source: 'snapshot',
      })
    }
    return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day))
  }, [mileageRows, snapshotMileageByDay, selectedDay, snapshotMileageFallback])

  const mileageRowsWithDifference = useMemo(() => {
    return mileageRowsWithSnapshot.map((row, idx, arr) => {
      const olderDay = arr[idx + 1]
      const delta = olderDay ? row.miles - olderDay.miles : null
      return { ...row, delta }
    })
  }, [mileageRowsWithSnapshot])

  const renderDetailField = (
    label: string,
    value: string | number | null | undefined,
    opts?: { fullWidth?: boolean }
  ) => {
    if (value == null) return null
    const text = String(value).trim()
    if (!text || text === '—') return null
    return (
      <div className={`svc-allocation-field${opts?.fullWidth ? ' svc-allocation-field--block' : ''}`}>
        <span className="svc-allocation-label">{label}</span>
        <span className="svc-allocation-value">{text}</span>
      </div>
    )
  }

  const sharedFrom = (
    vehicles: PtacVehicle[],
    pick: (v: PtacVehicle) => string | null
  ) => {
    if (vehicles.length === 0) return null
    const first = pick(vehicles[0])
    if (!first) return null
    return vehicles.every((v) => pick(v) === first) ? first : null
  }

  const summariseEnteredService = (vehicles: PtacVehicle[], sharedEntered: string | null) => {
    if (sharedEntered) return formatDateOnly(sharedEntered)
    const enteredByDate = new Map<string, string[]>()
    vehicles.forEach((v) => {
      const date = v.dateEnteredService || 'Unknown date'
      const label = v.vehicleId || `Pos ${v.position ?? '—'}`
      const arr = enteredByDate.get(date) || []
      arr.push(label)
      enteredByDate.set(date, arr)
    })
    return [...enteredByDate.entries()]
      .map(([date, ids]) => `${formatDateOnly(date)}: ${ids.join(', ')}`)
      .join(' | ')
  }

  useEffect(() => {
    if (!shouldFetchLatestService) return
    setLatestServiceError(null)
    const rid = latestRidForSelection
    if (!rid) return

    const ac = new AbortController()
    const dateFromDay = selectedDay !== 'all' ? selectedDay : darwinRidToIsoDate(rid)
    const qp = new URLSearchParams()
    if (dateFromDay) qp.set('date', dateFromDay)
    const url = `/api/darwin/service/${encodeURIComponent(rid)}${qp.toString() ? `?${qp.toString()}` : ''}`
    fetchDarwin(url, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(serviceDetailErrorMessage(res.status, body, dateFromDay))
        }
        return res.json()
      })
      .then((detail: ServiceDetail) => {
        setLatestService(detail)
        setLatestServiceError(null)
      })
      .catch((e) => {
        if ((e as Error)?.name === 'AbortError') return
        setLatestService(null)
        setLatestServiceError((e as Error)?.message || String(e))
      })

    return () => ac.abort()
  }, [latestRidForSelection, selectedDay, shouldFetchLatestService])

  useEffect(() => {
    setActiveTab('overview')
    setSnapshotMileageByDay({})
    setCatalogUnit(null)
    snapshotPrefetchAttemptedDaysRef.current = new Set()
  }, [unitId])

  useEffect(() => {
    if (!unitId || status !== 'ok' || !data) return
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      fetchDarwin('/api/darwin/units/catalog', { signal: ac.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then((payload: UnitCatalogResponse) => {
          const units = Array.isArray(payload.units) ? payload.units : []
          const match = units.find((u) => (u.unitId || '').trim().toUpperCase() === unitId)
          setCatalogUnit(match || null)
        })
        .catch((e) => {
          if ((e as Error)?.name === 'AbortError') return
        })
    }, 900)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [unitId, status, data])

  useEffect(() => {
    if (selectedDay === 'all') return
    if (snapshotMileageFallback == null) return
    setSnapshotMileageByDay((prev) => {
      if (prev[selectedDay] === snapshotMileageFallback) return prev
      return { ...prev, [selectedDay]: snapshotMileageFallback }
    })
  }, [selectedDay, snapshotMileageFallback])

  useEffect(() => {
    if (!data?.unitId) return
    const knownCatalogDays = new Set(mileageRows.map((row) => row.day))
    const daysToFetch = availableDays.filter((day) => {
      if (knownCatalogDays.has(day)) return false
      if (snapshotPrefetchAttemptedDaysRef.current.has(day)) return false
      return latestRidByDay.has(day)
    })
    if (daysToFetch.length === 0) return

    for (const day of daysToFetch) snapshotPrefetchAttemptedDaysRef.current.add(day)

    const ac = new AbortController()
    let cancelled = false
    const unitKey = data.unitId.trim().toUpperCase()

    const loadSnapshotMileage = async () => {
      for (const day of daysToFetch) {
        if (cancelled) return
        const rid = latestRidByDay.get(day)
        if (!rid) continue
        try {
          const qp = new URLSearchParams({ date: day })
          const res = await fetchDarwin(
            `/api/darwin/service/${encodeURIComponent(rid)}?${qp.toString()}`,
            { signal: ac.signal }
          )
          if (!res.ok) continue
          const detail = (await res.json()) as ServiceDetail
          const miles = (detail.consist?.allocations || [])
            .flatMap((a) => a.resourceGroups || [])
            .filter((g) => (g.unitId || '').trim().toUpperCase() === unitKey)
            .map((g) => g.endOfDayMiles)
            .find((m): m is number => typeof m === 'number' && Number.isFinite(m))
          if (miles == null) continue
          setSnapshotMileageByDay((prev) => {
            if (prev[day] === miles) return prev
            return { ...prev, [day]: miles }
          })
        } catch (e) {
          if ((e as Error)?.name === 'AbortError') return
        }
      }
    }

    void loadSnapshotMileage()
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [data?.unitId, availableDays, mileageRows, latestRidByDay])

  useEffect(() => {
    if (availableDays.length === 0) {
      return
    }

    if (!hasUnitDayQuery) {
      if (availableDays.includes(todayUk)) return
      updateQuery((next) => {
        next.set('unitDay', 'all')
      })
      return
    }

    if (selectedDay !== 'all' && !availableDays.includes(selectedDay)) {
      updateQuery((next) => {
        next.set('unitDay', 'all')
      })
    }
  }, [availableDays, selectedDay, hasUnitDayQuery, todayUk])

  return (
    <DarwinDetailsLayout
      title={title}
      subtitle={subtitle}
      headerClassName={`unit-header unit-header--${status}`}
      actionContent={(
        <div className="station-details-header-actions">
          <div className="station-details-header-actions__controls">
            <BUTWideButton
              width="hug"
              instantAction
              icon={<BackIcon />}
              onClick={() => router.push(`/units${location.search || ''}`)}
            >
              Back
            </BUTWideButton>
          </div>
        </div>
      )}
      sections={UNIT_SECTIONS}
      activeSectionId={activeTab}
      onSelect={(id) => {
        if (id === 'overview' || id === 'service' || id === 'logs' || id === 'services') {
          setActiveTab(id)
        }
      }}
      ariaLabel="Unit sections"
      minSectionCount={4}
    >
            {status === 'idle' && (
              <section className="unit-state-card">
                <p>Enter a unit ID to load PTAC unit details.</p>
              </section>
            )}

            {status === 'not-found' && (
              <section className="unit-state-card unit-state-card--error">
                <h2>Unit not found</h2>
                <p>No PTAC unit currently matches <code>{unitId}</code>.</p>
              </section>
            )}

            {status === 'error' && (
              <section className="unit-state-card unit-state-card--error">
                <h2>Unable to load unit detail</h2>
                <p>{error}</p>
              </section>
            )}

            {status === 'loading' && !data && (
              <section className="unit-state-card unit-loading-splash" aria-live="polite">
                <div className="unit-loading-spinner" aria-hidden="true" />
                <h2>Loading unit detail...</h2>
                <p>Loading today first, then fetching other days in the background.</p>
              </section>
            )}

            {data && (
              <section className="unit-date-filter-card" aria-label="Unit day filter">
                <label htmlFor="unit-detail-day-filter">Show unit data for day</label>
                <select
                  id="unit-detail-day-filter"
                  value={selectedDay}
                  onChange={(e) => {
                    const nextDay = e.target.value
                    updateQuery((next) => {
                      next.set('unitDay', nextDay)
                    })
                  }}
                >
                  <option value="all">All days in collection</option>
                  {availableDays.map((d) => (
                    <option key={d} value={d}>
                      {formatDateOnly(d)}
                    </option>
                  ))}
                </select>
              </section>
            )}

            {data && activeTab === 'overview' && (
              <section className="modal-section">
                <StationSectionTitle title="Overview" icon={Info} pageHeading />
                <section className="unit-summary-card">
                  <div className="modal-details-grid">
                    <StationDetailField label="Unit ID" value={data.unitId} />
                    <StationDetailField label="Fleet" value={data.fleetId || '-'} />
                    <StationDetailField label="Vehicles" value={String(data.vehicles.length)} />
                    <StationDetailField label="Services in diagram" value={String(filteredServices.length)} />
                  </div>
                </section>

                <section className="unit-list-card">
                  <h2>Per-day unit mileage</h2>
                  {mileageRowsWithDifference.length > 0 ? (
                    <div className="unit-mileage-list" role="list" aria-label="Per-day unit mileage">
                      {mileageRowsWithDifference.map((row) => (
                        <div key={row.day} className="unit-mileage-row" role="listitem">
                          <span className="unit-mileage-day">
                            {formatDateOnly(row.day)}
                            {row.source === 'snapshot' ? ' (snapshot)' : ''}
                          </span>
                          <span className="unit-mileage-value">{formatMiles(row.miles)}</span>
                          <span
                            className={`unit-mileage-delta ${
                              row.delta == null
                                ? 'is-neutral'
                                : row.delta > 0
                                  ? 'is-positive'
                                  : row.delta < 0
                                    ? 'is-negative'
                                    : 'is-neutral'
                            }`}
                            title="Difference vs previous day in list"
                          >
                            {formatMilesDelta(row.delta)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : snapshotMileageFallback != null ? (
                    <div className="unit-mileage-list" role="list" aria-label="Per-day unit mileage">
                      <div className="unit-mileage-row" role="listitem">
                        <span className="unit-mileage-day">
                          Latest unit snapshot
                        </span>
                        <span className="unit-mileage-value">{formatMiles(snapshotMileageFallback)}</span>
                      </div>
                      <p className="unit-mileage-note">
                        Mileage shown from latest unit snapshot (fallback), not catalog day totals.
                      </p>
                    </div>
                  ) : (
                    <p className="unit-muted">
                      No end-of-day mileage published yet.
                    </p>
                  )}
                </section>

                <section className="unit-list-card">
                  <h2>Vehicle IDs</h2>
                  <div className="unit-vehicle-list">
                    {data.vehicles.map((v, idx) => (
                      <span key={`${v.vehicleId || idx}`} className="unit-chip">{v.vehicleId || `Vehicle ${idx + 1}`}</span>
                    ))}
                  </div>
                </section>
              </section>
            )}

            {data && activeTab === 'logs' && (
              <section className="modal-section unit-list-card">
                <StationSectionTitle title="Unit logs" icon={WarningCircle} pageHeading />
                <div className="unit-services">
                  {!latestService && (
                    <p className="unit-muted">Loading latest service logs...</p>
                  )}
                  {latestService && latestServiceLogsByVehicle.map((row) => (
                    <details key={row.key} className="svc-collapsible-card svc-vehicle-card">
                      <summary className="svc-collapsible-summary">
                        <span className="svc-pattern-title">{row.vehicleId}</span>
                        <span className="unit-log-count-chip">{row.logCount}</span>
                      </summary>
                      <p className="unit-log-count-subtitle">Unit {row.unitId}</p>
                      {row.defects.length > 0 ? (
                        <ul className="svc-vehicle-log-list">
                          {row.defects.map((d, idx) => (
                            <li className="svc-vehicle-log-item" key={`${row.key}-full-${idx}`}>
                              <span className="svc-vehicle-log-main">
                                {d.code || 'No code'} — {d.description || 'No description'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="unit-muted">No logs for this vehicle.</p>
                      )}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {data && activeTab === 'service' && (
              <section className="modal-section unit-list-card">
                <StationSectionTitle
                  title={`Latest service${latestRidForSelection ? ` (${latestRidForSelection})` : ''}${selectedDay !== 'all' ? ` · ${formatDateOnly(selectedDay)}` : ''}`}
                  icon={Train}
                  pageHeading
                />
                {latestServiceError && (
                  <p className="unit-muted">Could not load latest service detail: {latestServiceError}</p>
                )}
                {latestService ? (
                  <>
                    <div className="unit-summary-grid">
                      <div className="unit-summary-item">
                        <span className="unit-summary-label">Service</span>
                        <span className="unit-summary-value">
                          {`${latestService.trainId} · ${latestService.originName || latestService.origin} -> ${latestService.destinationName || latestService.destination}`}
                        </span>
                      </div>
                      <div className="unit-summary-item">
                        <span className="unit-summary-label">Allocations</span>
                        <span className="unit-summary-value">{latestService.consist?.allocations?.length || 0}</span>
                      </div>
                      <div className="unit-summary-item">
                        <span className="unit-summary-label">Formation coaches</span>
                        <span className="unit-summary-value">{latestService.formation?.coaches?.length || 0}</span>
                      </div>
                      <div className="unit-summary-item">
                        <span className="unit-summary-label">Stops</span>
                        <span className="unit-summary-value">{latestService.stops.length}</span>
                      </div>
                    </div>
                    <div className="unit-service-formation">
                      <h3>Carriage map</h3>
                      <CarriageMap
                        formation={latestService.formation}
                        consist={latestService.consist}
                        stops={latestService.stops}
                        reverse={latestService.reverseFormation}
                        initialTpl={latestService.origin}
                      />
                    </div>

                    <div className="unit-service-vehicles">
                      {latestServiceUnitGroups.length === 0 ? (
                        <p className="unit-muted">No allocation groups available for this service.</p>
                      ) : (
                        <details className="svc-collapsible-card svc-vehicle-card" open>
                          <summary className="svc-collapsible-summary">
                            <span className="svc-pattern-title">Vehicle details & logs</span>
                          </summary>
                          <p className="svc-allocation-subtitle">Grouped by unit, then one section per vehicle.</p>
                          <div className="svc-vehicle-list">
                            {latestServiceUnitGroups.map((g) => {
                              const sortedVehicles = g.vehicles
                                .slice()
                                .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
                              const shared = {
                                vehicleType: sharedFrom(sortedVehicles, (v) => v.typeOfVehicle || null),
                                plannedGroup: sharedFrom(sortedVehicles, (v) => v.plannedGroupId || null),
                                maxSpeed: sharedFrom(sortedVehicles, (v) => (v.maximumSpeedMph != null ? `${v.maximumSpeedMph} mph` : null)),
                                brakeType: sharedFrom(sortedVehicles, (v) => v.trainBrakeTypeLabel || v.trainBrakeType || null),
                                status: sharedFrom(sortedVehicles, (v) => v.vehicleStatus || null),
                                category: sharedFrom(sortedVehicles, (v) => v.registeredCategoryLabel || v.registeredCategory || null),
                                liveryDecor: sharedFrom(sortedVehicles, (v) => ([v.livery, v.decor].filter(Boolean).join(' · ') || null)),
                                entered: sharedFrom(sortedVehicles, (v) => v.dateEnteredService || null),
                              }

                              return (
                                <article className="svc-unit-item" key={g.unitKey}>
                                  <header className="svc-vehicle-head">
                                    <h3 className="svc-vehicle-title">Unit {g.unitId || 'Unknown'}</h3>
                                  </header>
                                  <div className="svc-unit-shared">
                                    <h4 className="svc-vehicle-logs-title">Whole unit (shared details)</h4>
                                    <div className="svc-allocation-grid">
                                      {renderDetailField('Fleet', g.fleetId)}
                                      {renderDetailField('Resource type', g.resourceType)}
                                      {renderDetailField('Unit status', g.unitStatus)}
                                      {renderDetailField('End-of-day miles', g.endOfDayMiles)}
                                      {renderDetailField('Vehicle count', sortedVehicles.length)}
                                      {g.reversed ? renderDetailField('Formation direction', 'Reversed') : null}
                                      {renderDetailField('Vehicle type', shared.vehicleType)}
                                      {renderDetailField('Planned group', shared.plannedGroup)}
                                      {renderDetailField('Max speed', shared.maxSpeed)}
                                      {renderDetailField('Brake type', shared.brakeType)}
                                      {renderDetailField('Status', shared.status)}
                                      {renderDetailField('Category', shared.category)}
                                      {renderDetailField('Livery / decor', shared.liveryDecor)}
                                      {renderDetailField('Date entered service', summariseEnteredService(sortedVehicles, shared.entered), { fullWidth: true })}
                                    </div>
                                  </div>

                                  <div className="svc-unit-vehicles">
                                    {sortedVehicles.map((v, vIdx) => {
                                      const defects = v.defects || []
                                      const lengthWeight = (v.lengthMm != null || v.weightTonnes != null)
                                        ? `${v.lengthMm != null ? `${v.lengthMm} mm` : '—'} / ${v.weightTonnes != null ? `${v.weightTonnes} t` : '—'}`
                                        : null
                                      return (
                                        <article className="svc-vehicle-item" key={`${g.unitKey}-v-${v.vehicleId || vIdx}`}>
                                          <header className="svc-vehicle-head">
                                            <h4 className="svc-vehicle-title">{v.vehicleId || `Vehicle ${vIdx + 1}`}</h4>
                                            <div className="svc-allocation-tags">
                                              {v.position != null && <span className="svc-allocation-tag">Pos {v.position}</span>}
                                              {defects.length > 0 && <span className="svc-allocation-tag svc-allocation-tag--warn">{defects.length} log{defects.length === 1 ? '' : 's'}</span>}
                                            </div>
                                          </header>
                                          <div className="svc-allocation-grid">
                                            {renderDetailField('Specific type', v.specificType || null)}
                                            {renderDetailField('Seats', v.numberOfSeats ?? null)}
                                            {renderDetailField('Cabs', v.cabs ?? null)}
                                            {renderDetailField('Length / weight', lengthWeight)}
                                            {renderDetailField('Special characteristics', v.specialCharacteristics || null)}
                                            {renderDetailField('Vehicle name', v.vehicleName || null)}
                                            {renderDetailField('Date entered service', v.dateEnteredService ? formatDateOnly(v.dateEnteredService) : null)}
                                          </div>
                                          <p className="svc-vehicle-no-logs">Logs: {defects.length}</p>
                                        </article>
                                      )
                                    })}
                                  </div>
                                </article>
                              )
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                  </>
                ) : latestServiceError ? null : (
                  <p className="unit-muted">
                    {latestRidForSelection ? 'Loading latest service details...' : 'No service available for selected day.'}
                  </p>
                )}
              </section>
            )}

            {data && activeTab === 'services' && (
              <section className="modal-section unit-list-card">
                <StationSectionTitle title="Services" icon={CalendarBlank} pageHeading />
                <div className="unit-services">
                  {filteredServices.map((svc, idx) => (
                    <TextCard
                      key={`${svc.rid}-${idx}`}
                      title={`${svc.headcode || 'Service'} · ${formatTimeOnly(svc.start)} ${svc.startName || svc.startTpl || '-'} -> ${svc.endName || svc.endTpl || '-'} ${formatTimeOnly(svc.end)}`}
                      description={`${selectedDay === 'all' ? `${formatDateFromDateTime(svc.start)} · ` : ''}RID ${svc.rid}${svc.position != null ? ` · Pos ${svc.position}` : ''}${svc.reversed ? ' · Reversed' : ''}`}
                      state="default"
                      onClick={() => {
                        const qp = new URLSearchParams()
                        const serviceDate =
                          (selectedDay && selectedDay !== 'all' ? selectedDay : null) ||
                          darwinRidToIsoDate(svc.rid) ||
                          (svc.start ? svc.start.slice(0, 10) : null)
                        if (serviceDate) qp.set('date', serviceDate)
                        if (selectedDay && selectedDay !== 'all') qp.set('unitDay', selectedDay)
                        qp.set('from', `${location.pathname}${location.search || ''}`)
                        router.push(`/services/${encodeURIComponent(svc.rid)}${qp.toString() ? `?${qp.toString()}` : ''}`)
                      }}
                      ariaLabel={`Open service ${svc.headcode || svc.rid}`}
                    />
                  ))}
                  {filteredServices.length === 0 && (
                    <p className="unit-muted">No services recorded for this day.</p>
                  )}
                </div>
              </section>
            )}

            {data && (
              <p className="unit-muted darwin-details-source">
                Source: Network Rail Darwin Push Port and PTAC feed.{' '}
                <DataLicenceAttribution />
              </p>
            )}
    </DarwinDetailsLayout>
  )
}

export default UnitLookupPage