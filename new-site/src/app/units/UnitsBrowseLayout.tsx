'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'

import { BUTWideButton } from '@/components/buttons'
import BUTDDMList from '@/components/buttons/ddm/BUTDDMList'
import { PageTopHeader, SidebarDropdownSection, SidebarPanel } from '@/components/misc'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { isPlausibleUnitOperatingDay, ukCalendarYmd } from '@/utils/unitOperatingDay'
import { withUnitDay } from '@/utils/unitClassBands'
import '@/styles/browsePageLayout.css'
import './UnitsInServicePage.css'

export type FleetRow = { fleetId: string; unitCount: number }

const ALL_DAYS_LABEL = 'All units in collection'

export function formatDayLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type UnitsBrowseContextValue = ReturnType<typeof useUnitsBrowseFilters>

const UnitsBrowseContext = createContext<UnitsBrowseContextValue | null>(null)

export function useUnitsBrowse(): UnitsBrowseContextValue {
  const ctx = useContext(UnitsBrowseContext)
  if (!ctx) throw new Error('useUnitsBrowse must be used inside UnitsBrowseLayout')
  return ctx
}

type UnitsBrowseLayoutProps = {
  title: string
  subtitle: string
  backTo?: string
  backLabel?: string
  extraSidebar?: React.ReactNode
  children: React.ReactNode
}

export function useUnitsBrowseFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const locationSearch = searchParams.toString() ? `?${searchParams}` : ''
  const selectedDay = searchParams.get('unitDay') || 'all'
  const [searchInput, setSearchInput] = useState('')
  const [availableDays, setAvailableDays] = useState<string[]>([])
  const [fleets, setFleets] = useState<FleetRow[]>([])
  const [fleetsStatus, setFleetsStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [fleetsError, setFleetsError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const updateQuery = (updater: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString())
    updater(next)
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
  }

  const submitSearch = () => {
    const next = searchInput.trim().toUpperCase()
    if (!next) return
    router.push(withUnitDay(`/units/${encodeURIComponent(next)}`, selectedDay))
  }

  useEffect(() => {
    const ac = new AbortController()
    fetchDarwin('/api/darwin/units/days', { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ days?: string[] }>
      })
      .then((payload) => {
        const todayYmd = ukCalendarYmd()
        setAvailableDays((payload.days || []).filter((d) => isPlausibleUnitOperatingDay(d, todayYmd)))
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setAvailableDays([])
      })
    return () => ac.abort()
  }, [reloadToken])

  useEffect(() => {
    const ac = new AbortController()
    setFleetsStatus('loading')
    setFleetsError(null)
    const qs = selectedDay !== 'all' ? `?day=${encodeURIComponent(selectedDay)}` : ''
    fetchDarwin(`/api/darwin/units/fleets${qs}`, { signal: ac.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ fleets?: FleetRow[] }>
      })
      .then((payload) => {
        setFleets(Array.isArray(payload.fleets) ? payload.fleets : [])
        setFleetsStatus('ok')
      })
      .catch((e) => {
        if (ac.signal.aborted) return
        setFleets([])
        setFleetsStatus('error')
        setFleetsError((e as Error)?.message || 'Could not load classes.')
      })
    return () => ac.abort()
  }, [reloadToken, selectedDay])

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

  const dayItems = useMemo(
    () => [ALL_DAYS_LABEL, ...availableDays.map((d) => formatDayLabel(d))],
    [availableDays],
  )

  const selectedDayIndex = useMemo(() => {
    if (selectedDay === 'all') return 0
    const idx = availableDays.indexOf(selectedDay)
    return idx >= 0 ? idx + 1 : 0
  }, [availableDays, selectedDay])

  return {
    selectedDay,
    searchInput,
    setSearchInput,
    submitSearch,
    availableDays,
    fleets,
    fleetsStatus,
    fleetsError,
    reload: () => setReloadToken((n) => n + 1),
    updateQuery,
    dayItems,
    selectedDayIndex,
    locationSearch,
  }
}

export const UnitsBrowseLayout: React.FC<UnitsBrowseLayoutProps> = ({
  title,
  subtitle,
  backTo,
  backLabel = 'Back',
  extraSidebar,
  children,
}) => {
  const browse = useUnitsBrowseFilters()
  const {
    selectedDay,
    searchInput,
    setSearchInput,
    submitSearch,
    availableDays,
    updateQuery,
    dayItems,
    selectedDayIndex,
  } = browse

  return (
    <UnitsBrowseContext.Provider value={browse}>
    <div className="browse-page units-service-shell">
      <PageTopHeader
        title={title}
        subtitle={subtitle}
        className="units-service-header"
        actionButton={backTo ? { to: withUnitDay(backTo, selectedDay), label: backLabel } : undefined}
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
                  selectedPositions={availableDays.length > 0 || selectedDay === 'all' ? [selectedDayIndex] : []}
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
              {extraSidebar}
            </SidebarDropdownSection>
          </SidebarPanel>
        </aside>
        <main className="browse-main units-service-main">{children}</main>
      </div>
    </div>
    </UnitsBrowseContext.Provider>
  )
}

export function UnitsBrowseStatus({
  status,
  error,
  onRetry,
  loadingLabel,
}: {
  status: 'loading' | 'ok' | 'error'
  error: string | null
  onRetry: () => void
  loadingLabel: string
}) {
  if (status === 'loading') {
    return (
      <section className="units-service-message">
        <p>{loadingLabel}</p>
      </section>
    )
  }
  if (status === 'error') {
    return (
      <section className="units-service-message units-service-message--error">
        <h2>Could not load units</h2>
        <p>{error}</p>
        <BUTWideButton width="hug" instantAction colorVariant="primary" onClick={onRetry}>
          Try again
        </BUTWideButton>
      </section>
    )
  }
  return null
}
