'use client'

import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, MagnifyingGlass, X } from '@phosphor-icons/react'

import { useDepartures } from '@/hooks/useDepartures'
import type { DepartureRow, DepartureServiceType, DeparturesSnapshot } from '@/types/darwin'
import { useDarwinLocationLookup, useDarwinLocationSearch, type DarwinCatalogLocation } from '@/hooks/useDarwinLocationSearch'
import { BackIcon } from '@/components/icons'
import { PageTopHeader, SidebarDropdownSection, SidebarPanel } from '@/components/misc'
import { BUTBaseButton, BUTCircleButton, BUTOperatorChip, BUTTwoButtonBar, BUTWideButton, TOGToggleVisited } from '@/components/buttons'
import { ServiceViewModeToggle } from '@/components/darwin/ServiceViewModeToggle'
import { useServiceViewMode } from '@/components/darwin/serviceViewMode'
import BUTDDMList from '@/components/buttons/ddm/BUTDDMList'
import BUTDDMListActionDual from '@/components/buttons/ddm/BUTDDMListActionDual'
import { DarwinServiceCard } from '@/components/cards'
import TXTINPBUTWideButton from '@/components/textInputButtons/plain/TXTINPBUTWideButton'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import { StationMessages } from '@/components/darwin/StationMessages'
import { KnowledgebaseIncidentsBanner } from '@/components/darwin/KnowledgebaseIncidentsBanner'
import DataLicenceAttribution from '@/components/darwin/DataLicenceAttribution'
import { railwayOperatingDayIsoFromLondonParts, scheduledTimeInRailwayWindow, normalizeClockHhmm } from '@/utils/railwayOperatingDayUk'
import { paramAsString } from '@/utils/nextParams'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { parseHistoryDatesList } from '@/utils/normalizeRailCore'
import { peekHotHealth, peekHotHistoryDates } from '@/utils/darwinHotCache'
import { prefetchDarwinService } from '@/hooks/useServiceDetail'
import { formatLmTocName } from '@/utils/formatLmTocName'
import { isoDateToDdMmYyyy } from '@/utils/dateDdMmYyyy'
import '@/styles/browsePageLayout.css'
import '@/app/departures/DarwinDeparturesPage.css'

type StopModeFilter = 'calling' | 'passing'
type BoardModeFilter = 'departures' | 'arrivals'
type StationSearchMode = 'name' | 'crs' | 'tiploc'

const WINDOW_OPTIONS = [
  { label: '1 hour',   value: 1 },
  { label: '3 hours',  value: 3 },
  { label: '6 hours',  value: 6 },
  { label: '12 hours', value: 12 },
]
const WINDOW_VALUES = new Set(WINDOW_OPTIONS.map((opt) => opt.value))

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', hour12: false, timeZone: 'Europe/London',
  })
}

function formatAge(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

const HEADER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function formatHeaderDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return dateStr
  const month = HEADER_MONTHS[Number(match[2]) - 1]
  if (!month) return dateStr
  return `${Number(match[3])} ${month} ${match[1]}`
}

function formatLiveNowUk(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', hour12: false,
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00'
  const month = HEADER_MONTHS[Number(pick('month')) - 1] || pick('month')
  return `${Number(pick('day'))} ${month} ${pick('year')}, ${pick('hour')}:${pick('minute')}`
}

function getLiveNowPartsUk(now = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', hour12: false,
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00'
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}`,
  }
}

function normalizeTimeInput(raw: string): string | null {
  return normalizeClockHhmm(raw)
}

function getCurrentRailwayDayIsoUk(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23', hour12: false,
  }).formatToParts(now)

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00'

  const year = Number(pick('year'))
  const month = Number(pick('month'))
  const day = Number(pick('day'))
  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))

  return railwayOperatingDayIsoFromLondonParts(year, month, day, hour, minute)
}

/** Operating-day key matching `railwayDayYmd` in departures-daemon (02:00 Europe/London). */
function railwayOperatingDayIsoUk(dateStr: string, timeHHMM: string): string {
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeHHMM.trim())
  if (!tm) return dateStr
  const h = Number(tm[1]); const mi = Number(tm[2])
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!dm || !Number.isFinite(h) || !Number.isFinite(mi)) return dateStr
  const y = Number(dm[1]); const mo = Number(dm[2]); const d = Number(dm[3])
  return railwayOperatingDayIsoFromLondonParts(y, mo, d, h, mi)
}

function addDaysIsoDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateStr
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const FORMATION_STORAGE_KEY = 'rs.darwin.showFormation'

function readFormationPreference(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const stored = window.localStorage.getItem(FORMATION_STORAGE_KEY)
    if (stored == null) return true
    return stored === '1'
  } catch {
    return true
  }
}

function writeFormationPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(FORMATION_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* quota / private mode */
  }
}

type DarwinDepartureRowCardProps = {
  row: DepartureRow
  historicalMode: boolean
  detailedInfo: boolean
  showFormation: boolean
  code: string
  hours: number
  historyDate: string
  historyTime: string
}

/**
 * Isolated from the page so per-second age ticks (useDepartures) do not rebuild
 * every service card when the snapshot reference is unchanged.
 */
const DarwinDepartureRowCard = React.memo(function DarwinDepartureRowCard({
  row,
  historicalMode,
  detailedInfo,
  showFormation,
  code,
  hours,
  historyDate,
  historyTime,
}: DarwinDepartureRowCardProps) {
  const router = useRouter()
  const detailPhrase =
    row.movement === 'arrival'
      ? `arrival ${formatTime(row.scheduledAt)} from ${row.originName || row.origin}`
      : `${formatTime(row.scheduledAt)} to ${row.destinationName || row.destination}`
  const ariaState = row.cancelled ? 'cancelled' : historicalMode ? 'historical snapshot' : 'live status'

  const onClick = useCallback(() => {
    const qp = new URLSearchParams()
    const now = getLiveNowPartsUk()
    const frozen = Boolean(historyDate) && (historyDate !== now.date || (historyTime && historyTime !== now.time))
    const serviceDate = frozen ? historyDate : undefined
    const serviceAt = frozen && historyTime ? historyTime : undefined
    if (serviceDate) qp.set('date', serviceDate)
    if (serviceAt) qp.set('at', serviceAt)
    const backQs = new URLSearchParams()
    backQs.set('hours', String(hours))
    if (serviceDate) backQs.set('date', serviceDate)
    if (serviceAt) backQs.set('at', serviceAt)
    qp.set('from', `/departures/${encodeURIComponent(code)}?${backQs.toString()}`)
    prefetchDarwinService(row.rid, serviceDate, serviceAt)
    router.push(`/services/${encodeURIComponent(row.rid)}?${qp.toString()}`)
  }, [router, historyDate, historyTime, code, hours, row.rid])

  return (
    <div
      role="listitem"
      onPointerEnter={() => {
        if (!detailedInfo) return
        const now = getLiveNowPartsUk()
        const frozen = Boolean(historyDate) && (historyDate !== now.date || (historyTime && historyTime !== now.time))
        prefetchDarwinService(row.rid, frozen ? historyDate : undefined, frozen && historyTime ? historyTime : undefined)
      }}
    >
      <DarwinServiceCard
        row={row}
        historicalMode={historicalMode}
        detailedInfo={detailedInfo}
        showFormation={showFormation}
        onClick={onClick}
        ariaLabel={`View details for ${detailPhrase}, ${ariaState}`}
      />
    </div>
  )
})

type DarwinSearchHit = {
  id: string
  stationName: string
  crsCode: string
  tiploc: string | null
}

function catalogToSearchHit(row: DarwinCatalogLocation): DarwinSearchHit {
  return {
    id: `tpl:${row.tiploc}`,
    stationName: row.name,
    crsCode: row.crs,
    tiploc: row.tiploc,
  }
}

function resolveSearchInput(rawInput: string): string | null {
  const compact = rawInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return compact || null
}

function normalizeSearchInputForMode(raw: string, mode: StationSearchMode): string {
  if (mode === 'name') return raw
  if (mode === 'crs') return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

function searchPlaceholderForMode(mode: StationSearchMode): string {
  if (mode === 'crs') return 'CRS (3 letters) e.g. LDS'
  if (mode === 'tiploc') return 'TIPLOC (max 10) e.g. LEEDS'
  return 'Station name e.g. Leeds'
}

const SERVICE_TYPE_LABELS: Record<DepartureServiceType, string> = {
  passenger: 'Passenger',
  freight: 'Freight',
  'rail-replacement': 'Rail replacement',
  other: 'Other',
}
const ALL_SERVICE_TYPES = Object.keys(SERVICE_TYPE_LABELS) as DepartureServiceType[]
const STOP_MODE_OPTIONS: StopModeFilter[] = ['calling', 'passing']
const STOP_MODE_LABELS: Record<StopModeFilter, string> = {
  calling: 'Stopping',
  passing: 'Passing',
}
const BOARD_MODE_LABELS: Record<BoardModeFilter, string> = {
  departures: 'Departures',
  arrivals: 'Arrivals',
}
const UNKNOWN_TOC_LABEL = 'Unknown'

function tocFilterLabel(row: DepartureRow): string {
  const label = formatLmTocName(row.tocName, row.toc, row.originCrs, row.destinationCrs)
  return label && label.trim() ? label : UNKNOWN_TOC_LABEL
}

function titleCaseWord(word: string): string {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function stationLikeNameFromTiploc(tpl: string): string | null {
  const raw = (tpl || '').trim().toUpperCase()
  if (!raw) return null
  if (/^[A-Z0-9]{4,}$/.test(raw)) {
    const expanded = raw
      .replace(/JNCT$/g, ' JNCT')
      .replace(/JCN$/g, ' JCN')
      .replace(/JN$/g, ' JN')
      .replace(/J$/g, ' JN')
      .replace(/PASS$/g, ' PASS')
      .replace(/PSS$/g, ' PSS')
      .replace(/HALT$/g, ' HALT')
      .replace(/(?:\d)(?=[A-Z])/g, '$& ')
      .replace(/([A-Z])([0-9])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
    const words = expanded.split(' ')
    return words.map((w) => {
      if (w === 'JN') return 'Jn'
      if (w === 'JCN') return 'Jcn'
      if (w === 'JNCT') return 'Jnct'
      if (w === 'PSS') return 'Pss'
      return titleCaseWord(w)
    }).join(' ')
  }
  return null
}

function isRawTiplocLikeName(name: string | null | undefined, fallbackCode: string): boolean {
  if (!name) return true
  const n = name.trim().toUpperCase()
  const c = (fallbackCode || '').trim().toUpperCase()
  if (!n) return true
  if (n === c) return true
  // Treat all-uppercase compact tokens as likely TIPLOC-style labels.
  return /^[A-Z0-9]{4,}$/.test(n)
}

const DarwinDeparturesPage: React.FC<{ initialSnapshot?: DeparturesSnapshot | null }> = ({
  initialSnapshot = null,
}) => {
  const params = useParams()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = { pathname, search: searchParams.toString() ? `?${searchParams}` : '', state: null as unknown }
  const router = useRouter()
  const code = paramAsString(params.code).toUpperCase()
  const hasStationSelected = code.length > 0
  const [searchInput, setSearchInput] = useState<string>('')
  const [searchMode, setSearchMode] = useState<StationSearchMode>('name')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [historyDateError, setHistoryDateError] = useState<string | null>(null)
  const [tocSelection, setTocSelection] = useState<string[] | null>(null)
  const [typeSelection, setTypeSelection] = useState<DepartureServiceType[] | null>(null)
  const [selectedStopModes, setSelectedStopModes] = useState<StopModeFilter[]>(STOP_MODE_OPTIONS)
  const [viewMode, setViewMode] = useServiceViewMode()
  const showDetailedInfo = viewMode === 'detailed'
  const [showFormation, setShowFormation] = useState(true)
  const [boardMode, setBoardMode] = useState<BoardModeFilter>('departures')
  const [historyDates, setHistoryDates] = useState<string[]>(() => peekHotHistoryDates() || [])
  const [liveClockReady, setLiveClockReady] = useState(false)
  const catalogHits = useDarwinLocationSearch(searchInput)
  const catalogHere = useDarwinLocationLookup(hasStationSelected ? code : '')

  useEffect(() => {
    setLiveClockReady(true)
  }, [])

  useEffect(() => {
    setShowFormation(readFormationPreference())
  }, [])

  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const from = query.get('from') || ''
  const clickedLabel = query.get('label') || ''
  const historyDate = query.get('date') || ''
  const historyTime = query.get('at') || ''
  const initialLiveWall = useMemo(() => getLiveNowPartsUk(), [])
  const [historyDateDraft, setHistoryDateDraft] = useState<string>(historyDate || initialLiveWall.date)
  const [historyTimeDraft, setHistoryTimeDraft] = useState<string>(historyTime || initialLiveWall.time)
  const [operatingDayHelpOpen, setOperatingDayHelpOpen] = useState(false)
  const todayIsoDate = getCurrentRailwayDayIsoUk()
  const minLookbackDateIso = addDaysIsoDate(todayIsoDate, -1)
  const [maxFutureDateIso, setMaxFutureDateIso] = useState(() => {
    const max = peekHotHealth()?.timetableWindow?.maxDate
    if (typeof max === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(max)) return max
    return addDaysIsoDate(todayIsoDate, 30)
  })
  const operatingDayForMode = useMemo(() => {
    if (!historyDate) return todayIsoDate
    const clock = historyTime ? normalizeClockHhmm(historyTime) : null
    if (clock) return railwayOperatingDayIsoUk(historyDate, clock)
    return historyDate
  }, [historyDate, historyTime, todayIsoDate])
  const hoursFromQuery = Number(query.get('hours') || WINDOW_OPTIONS[0].value)
  const hours = WINDOW_VALUES.has(hoursFromQuery) ? hoursFromQuery : WINDOW_OPTIONS[0].value
  const datedBoard = Boolean(historyDate)
  const historicalMode = Boolean(historyDate && operatingDayForMode < todayIsoDate)
  const timedCurrentDayMode = Boolean(historyDate && operatingDayForMode === todayIsoDate && Boolean(historyTime))
  const futureTimetableMode = Boolean(historyDate && operatingDayForMode > todayIsoDate)

  useEffect(() => {
    if (historyDate) setHistoryDateDraft(historyDate)
    if (historyTime) setHistoryTimeDraft(historyTime)
    if (!historyDate && !historyTime) {
      const now = getLiveNowPartsUk()
      setHistoryDateDraft(now.date)
      setHistoryTimeDraft(now.time)
    }
  }, [historyDate, historyTime])

  useEffect(() => {
    if (!operatingDayHelpOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOperatingDayHelpOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [operatingDayHelpOpen])

  const updateQuery = (updater: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(location.search)
    updater(next)
    const qs = next.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  const { status, data, error, ageMs, refetch } = useDepartures({
    code: hasStationSelected ? code : '',
    hours,
    date: historyDate || undefined,
    at: historyTime || undefined,
    historicalDayBoard: datedBoard && !historyTime,
    cisMode: viewMode === 'simple',
    initialSnapshot: hasStationSelected ? initialSnapshot : null,
  })
  const boardReady = !hasStationSelected || (status !== 'idle' && status !== 'loading')

  useEffect(() => {
    setSearchInput('')
    setSearchError(null)
    setBoardMode('departures')
  }, [code])

  useEffect(() => {
    if (!boardReady) return
    let cancelled = false
    const loadWindow = async () => {
      const hot = peekHotHealth()?.timetableWindow?.maxDate
      if (hot && /^\d{4}-\d{2}-\d{2}$/.test(hot)) {
        if (!cancelled) setMaxFutureDateIso(hot)
        return
      }
      try {
        const res = await fetchDarwin('/api/darwin/window')
        if (!res.ok) return
        const body = await res.json() as { timetableWindow?: { maxDate?: string } }
        const max = body?.timetableWindow?.maxDate
        if (!cancelled && typeof max === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(max)) {
          setMaxFutureDateIso(max)
        }
      } catch {
        // Keep the 30-day fallback until the daemon reports the CIF horizon.
      }
    }
    void loadWindow()
    return () => {
      cancelled = true
    }
  }, [boardReady])

  useEffect(() => {
    if (!boardReady) return
    let cancelled = false
    const load = async () => {
      const hot = peekHotHistoryDates()
      if (hot?.length) {
        if (!cancelled) setHistoryDates(hot)
        return
      }
      try {
        const res = await fetchDarwin('/api/darwin/history/dates')
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const body = await res.json()
        if (cancelled) return
        setHistoryDates(parseHistoryDatesList(body))
      } catch {
        if (cancelled) return
        setHistoryDates([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [boardReady, minLookbackDateIso])

  const submitSearch = () => {
    const normalizedInput = normalizeSearchInputForMode(searchInput, searchMode).trim()
    let next: string | null = null
    if (searchMode === 'name') {
      next = catalogHits[0]?.tiploc || catalogHits[0]?.crs || resolveSearchInput(normalizedInput)
      if (!next) {
        setSearchError('No station name match found. Try the full station name or switch mode.')
        return
      }
    } else if (searchMode === 'crs') {
      if (normalizedInput.length !== 3) {
        setSearchError('CRS must be exactly 3 uppercase letters.')
        return
      }
      const byCrs = catalogHits.find((row) => row.crs === normalizedInput) || catalogHits[0]
      next = byCrs?.tiploc || byCrs?.crs || normalizedInput
    } else {
      if (!normalizedInput) {
        setSearchError('Enter a TIPLOC code (up to 10 uppercase characters).')
        return
      }
      const byTiploc = catalogHits.find((row) => row.tiploc === normalizedInput) || catalogHits[0]
      next = byTiploc?.tiploc || normalizedInput
    }
    const normalizedNext = String(next).toUpperCase()
    if (normalizedNext === code) return
    setSearchError(null)
    router.push(`/departures/${normalizedNext}${location.search}`)
  }

  const setSearchModeAndFocus = (nextMode: StationSearchMode) => {
    setSearchError(null)
    setSearchMode(nextMode)
    setSearchInput((prev) => normalizeSearchInputForMode(prev, nextMode))
  }

  const stationLabel = useMemo(() => {
    if (!hasStationSelected) return 'Live departures'
    if (clickedLabel.trim()) return clickedLabel.trim()
    if (catalogHere?.name && !isRawTiplocLikeName(catalogHere.name, code)) {
      return catalogHere.crs ? `${catalogHere.name} (${catalogHere.crs})` : catalogHere.name
    }
    if (data?.stationName && !isRawTiplocLikeName(data.stationName, code)) {
      return data.stationCrs ? `${data.stationName} (${data.stationCrs})` : data.stationName
    }
    if (data?.stationName) {
      const humanized = stationLikeNameFromTiploc(data.stationName)
      if (humanized) return data.stationCrs ? `${humanized} (${data.stationCrs})` : humanized
    }
    const stationLikeFallback = stationLikeNameFromTiploc(code.toUpperCase())
    if (stationLikeFallback) return stationLikeFallback
    return code
  }, [code, data, hasStationSelected, clickedLabel, catalogHere])

  const windowSelectedIndex = useMemo(() => {
    const idx = WINDOW_OPTIONS.findIndex((opt) => opt.value === hours)
    return idx >= 0 ? idx : 0
  }, [hours])

  const snapshotMovementRows = useMemo(() => {
    if (!data) return []
    return [...data.departures, ...(data.arrivals ?? [])]
  }, [data])

  const tocOptions = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(snapshotMovementRows.map((row) => tocFilterLabel(row))))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [data, snapshotMovementRows])

  const serviceTypeOptions = ALL_SERVICE_TYPES

  const selectedTocs = tocSelection && tocSelection.length > 0 ? tocSelection : tocOptions
  const selectedServiceTypes = typeSelection && typeSelection.length > 0 ? typeSelection : serviceTypeOptions
  const historyWindowStart = historyTime || (datedBoard ? '02:00' : getLiveNowPartsUk().time)

  useEffect(() => {
    setTocSelection(null)
    setTypeSelection(null)
  }, [code, hours, historyDate, historyTime])

  useEffect(() => {
    setSelectedStopModes(STOP_MODE_OPTIONS)
  }, [code])

  const filteredDepartures = useMemo(() => {
    if (!data) return []
    return data.departures.filter((row) => {
      const tocLabel = tocFilterLabel(row)
      const tocMatch = selectedTocs.includes(tocLabel)
      const rowServiceType = row.serviceType || 'other'
      const serviceTypeMatch = selectedServiceTypes.includes(rowServiceType)
      const stopMode: StopModeFilter = row.isPassing ? 'passing' : 'calling'
      const stopModeMatch = showDetailedInfo
        ? selectedStopModes.includes(stopMode)
        : true
      const timeMatch = scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)
      return tocMatch && serviceTypeMatch && stopModeMatch && timeMatch
    })
  }, [data, selectedTocs, selectedServiceTypes, selectedStopModes, showDetailedInfo, datedBoard, historyTime, historyWindowStart, hours])

  const filteredArrivals = useMemo(() => {
    if (!data) return []
    const arrivals = data.arrivals ?? []
    return arrivals.filter((row) => {
      const tocLabel = tocFilterLabel(row)
      const tocMatch = selectedTocs.includes(tocLabel)
      const rowServiceType = row.serviceType || 'other'
      const serviceTypeMatch = selectedServiceTypes.includes(rowServiceType)
      const timeMatch = scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)
      return tocMatch && serviceTypeMatch && timeMatch
    })
  }, [data, selectedTocs, selectedServiceTypes, datedBoard, historyTime, historyWindowStart, hours])

  const activeFilteredRows =
    boardMode === 'departures' ? filteredDepartures : filteredArrivals

  const boardRows = activeFilteredRows

  const filteredCounts = useMemo(
    () => ({ rows: activeFilteredRows.length }),
    [activeFilteredRows],
  )

  const subtitle = useMemo<React.ReactNode>(() => {
    const movementWord = boardMode === 'departures' ? 'departures' : 'arrivals'
    const countWindowHours = hours
    const countPrefix = data
      ? datedBoard
        ? `${filteredCounts.rows} ${movementWord} from ${historyWindowStart} for ${countWindowHours} hour${countWindowHours === 1 ? '' : 's'}`
        : `${filteredCounts.rows} ${movementWord} in the next ${countWindowHours} hour${countWindowHours === 1 ? '' : 's'}`
      : null

    if (!hasStationSelected) return 'Search by station name, CRS, or TIPLOC'
    const modeSuffix = historicalMode ? ' (historical)' : futureTimetableMode ? ' (timetable)' : ''
    const operatingDayLabel = formatHeaderDate(
      data?.historicalDate ?? (historyDate ? (historyTime ? operatingDayForMode : historyDate) : todayIsoDate),
    )
    const boardDateText = historyDate && historyTime
      ? `Wall clock: ${formatHeaderDate(historyDate)} · ${historyTime} · Operating day: ${operatingDayLabel}${modeSuffix}`
      : `Operating day: ${operatingDayLabel}${modeSuffix}`
    const liveNowText = !liveClockReady || historicalMode || futureTimetableMode ? null : `Live now: ${formatLiveNowUk()}`

    if (status === 'ok') {
      const statusText = historicalMode
        ? `Saved Darwin actuals for ${formatHeaderDate(historyDate)}`
        : timedCurrentDayMode
          ? `Timed board from ${historyTime}`
        : futureTimetableMode
          ? `Timetable view${historyTime ? ` at ${historyTime}` : ' for selected date'}`
        : `Live board · auto-refreshing · updated ${formatAge(ageMs)}`
      return countPrefix ? (
        <>
          <span className="dep-subtitle__count">{countPrefix}</span>
          {'\n'}
          <span className="dep-subtitle__status">{statusText}</span>
          {'\n'}
          <span className="dep-subtitle__status">{boardDateText}</span>
          {liveNowText ? (
            <>
              {'\n'}
              <span className="dep-subtitle__status">{liveNowText}</span>
            </>
          ) : null}
        </>
      ) : <span className="dep-subtitle__status">{statusText}</span>
    }
    if (status === 'stale') {
      const statusText = historicalMode
        ? `Saved Darwin actuals for ${formatHeaderDate(historyDate)}`
        : timedCurrentDayMode
          ? `Timed board from ${historyTime}`
        : futureTimetableMode
          ? `Timetable view${historyTime ? ` at ${historyTime}` : ' for selected date'}`
        : `Stale live board · ${formatAge(ageMs)}`
      return countPrefix ? (
        <>
          <span className="dep-subtitle__count">{countPrefix}</span>
          {'\n'}
          <span className="dep-subtitle__status">{statusText}</span>
          {'\n'}
          <span className="dep-subtitle__status">{boardDateText}</span>
          {liveNowText ? (
            <>
              {'\n'}
              <span className="dep-subtitle__status">{liveNowText}</span>
            </>
          ) : null}
        </>
      ) : <span className="dep-subtitle__status">{statusText}</span>
    }
    if (status === 'loading') {
      return (
        <span className="dep-subtitle__status">
          Loading {boardMode === 'departures' ? 'departures' : 'arrivals'} for {boardDateText.toLowerCase()}…
        </span>
      )
    }
    if (status === 'error')     return <span className="dep-subtitle__status">{error ? `Error: ${error}` : 'Board data unavailable'} · {boardDateText}</span>
    if (status === 'not-found') return <span className="dep-subtitle__status">Unknown station</span>
    return ''
  }, [status, error, ageMs, hasStationSelected, data, filteredCounts.rows, boardMode, historicalMode, timedCurrentDayMode, historyDate, historyTime, historyWindowStart, hours, futureTimetableMode, todayIsoDate, operatingDayForMode, liveClockReady])

  const stationSuggestions = useMemo(() => {
    return catalogHits.map(catalogToSearchHit)
  }, [catalogHits])

  const openDeparturesForStation = (station: DarwinSearchHit) => {
    const targetCode = (station.tiploc || station.crsCode || '').toUpperCase()
    if (!targetCode) return
    setSearchError(null)
    setSearchInput('')
    router.push(`/departures/${targetCode}${location.search}`)
  }

  const availableHistoryDatesSet = useMemo(() => new Set(historyDates), [historyDates])
  const minPickerDateIso = historyDates.length
    ? [...historyDates].sort((a, b) => a.localeCompare(b))[0]
    : addDaysIsoDate(todayIsoDate, -90)

  const applyDateTimeFilter = (dateRaw = historyDateDraft, timeRaw = historyTimeDraft) => {
    const dateValue = dateRaw.trim()
    const normalizedTime = normalizeTimeInput(timeRaw)
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    const timeOk = normalizedTime !== null
    if (!dateOk) {
      setHistoryDateError('Choose a date.')
      return
    }
    if (!timeOk) {
      setHistoryDateError('Choose a time.')
      return
    }
    if (dateValue > maxFutureDateIso) {
      setHistoryDateError(`Future timetable view currently supports up to ${formatHeaderDate(maxFutureDateIso)}.`)
      return
    }
    const lookbackOk = dateValue >= minLookbackDateIso
    if (dateValue < todayIsoDate && !availableHistoryDatesSet.has(dateValue) && !lookbackOk) {
      setHistoryDateError('That date is not available in historical snapshots.')
      return
    }
    setHistoryDateError(null)
    const now = getLiveNowPartsUk()
    const operatingDay = railwayOperatingDayIsoUk(dateValue, normalizedTime || now.time)
    const live = operatingDay === todayIsoDate && normalizedTime === now.time
    updateQuery((next) => {
      if (live) {
        next.delete('date')
        next.delete('at')
        return
      }
      next.set('date', dateValue)
      if (normalizedTime) next.set('at', normalizedTime)
      else next.delete('at')
    })
  }

  const resetToLiveNow = () => {
    const now = getLiveNowPartsUk()
    setHistoryDateDraft(now.date)
    setHistoryTimeDraft(now.time)
    setHistoryDateError(null)
    updateQuery((next) => {
      next.delete('date')
      next.delete('at')
    })
  }

  return (
    <div className="browse-page darwin-departures-shell">
      <PageTopHeader
        title={stationLabel}
        subtitle={subtitle}
        className={`darwin-departures-header darwin-departures-header--${status}`}
        actionButton={from ? {
          label: 'Back',
          mode: 'iconText',
          icon: <BackIcon />,
          onClick: () => router.push(from),
        } : undefined}
      />

      <div className="browse-page-content">
          <aside className="browse-sidebar" aria-label="Board controls">
            <SidebarPanel className="browse-sidebar-panel dep-sidebar-panel">
              <div className="dep-board-top">
                <span className="dep-filter-label" id="dep-filter-board-label">Board</span>
                <BUTTwoButtonBar
                  className="dep-board-mode"
                  colorVariant="primary"
                  selectedIndex={boardMode === 'departures' ? 0 : 1}
                  buttons={[
                    { label: BOARD_MODE_LABELS.departures, value: 'departures' },
                    { label: BOARD_MODE_LABELS.arrivals, value: 'arrivals' },
                  ]}
                  onChange={(_, value) => {
                    if (value === 'departures' || value === 'arrivals') {
                      setBoardMode(value)
                    }
                  }}
                />
                <div className="dep-detail-toggle">
                  <ServiceViewModeToggle
                    className="dep-detail-toggle__viewmode"
                    viewMode={viewMode}
                    onChange={setViewMode}
                  />
                </div>
                <div className="dep-detail-toggle">
                  <span className="dep-filter-label dep-detail-toggle__label">Show Formation (Where available)</span>
                  <TOGToggleVisited
                    checked={showFormation}
                    onChange={(next) => {
                      setShowFormation(next)
                      writeFormationPreference(next)
                    }}
                    ariaLabel="Show formation on service cards where available"
                    className="dep-detail-toggle__control"
                  />
                </div>
              </div>

              <SidebarDropdownSection
                key={hasStationSelected ? 'search-station' : 'search-home'}
                title="Search"
                defaultExpanded={!hasStationSelected}
              >
                <div className="search-container tickets-od-stack">
                  <TXTINPBUTIconWideButtonSearch
                    id="darwin-station-search"
                    icon={<MagnifyingGlass size={16} aria-hidden />}
                    value={searchInput}
                    onChange={(value) => {
                      setSearchInput(normalizeSearchInputForMode(value, searchMode))
                      if (searchError) setSearchError(null)
                    }}
                    onClear={() => {
                      setSearchInput('')
                      setSearchError(null)
                    }}
                    onSubmit={submitSearch}
                    enterKeyHint="search"
                    placeholder={searchPlaceholderForMode(searchMode)}
                    className="search-input-shell tickets-od-input"
                    colorVariant="primary"
                    showClear
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  {stationSuggestions.length > 0 && (
                    <div className="tickets-station-suggestions" role="listbox" aria-label="Station suggestions">
                      {stationSuggestions.map((station, index) => {
                        const isLast = index === stationSuggestions.length - 1
                        const codeLabel =
                          searchMode === 'tiploc'
                            ? (station.tiploc || station.crsCode || '').toUpperCase()
                            : (station.crsCode || station.tiploc || '').toUpperCase()
                        return (
                          <BUTBaseButton
                            key={station.id}
                            type="button"
                            variant="wide"
                            width="fill"
                            shape={isLast ? 'bottom-rounded' : 'squared'}
                            colorVariant="primary"
                            instantAction
                            className="tickets-station-suggestion"
                            ariaLabel={
                              codeLabel
                                ? `${station.stationName} (${codeLabel})`
                                : station.stationName
                            }
                            onClick={() => openDeparturesForStation(station)}
                          >
                            <span className="tickets-station-suggestion__label">
                              <span className="tickets-station-suggestion__name">{station.stationName}</span>
                              {codeLabel ? (
                                <span className="tickets-station-suggestion__crs">{codeLabel}</span>
                              ) : null}
                            </span>
                          </BUTBaseButton>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="stations-search-mode-chips-reveal">
                  <div className="stations-search-mode-chips" role="group" aria-label="Search by">
                    <BUTOperatorChip
                      instantAction
                      colorVariant="primary"
                      width="hug"
                      state={searchMode === 'name' ? 'pressed' : 'active'}
                      onClick={() => setSearchModeAndFocus('name')}
                      aria-label="Search by station name"
                    >
                      Name
                    </BUTOperatorChip>
                    <BUTOperatorChip
                      instantAction
                      colorVariant="primary"
                      width="hug"
                      state={searchMode === 'crs' ? 'pressed' : 'active'}
                      onClick={() => setSearchModeAndFocus('crs')}
                      aria-label="Search by CRS code"
                    >
                      CRS
                    </BUTOperatorChip>
                    <BUTOperatorChip
                      instantAction
                      colorVariant="primary"
                      width="hug"
                      state={searchMode === 'tiploc' ? 'pressed' : 'active'}
                      onClick={() => setSearchModeAndFocus('tiploc')}
                      aria-label="Search by TIPLOC code"
                    >
                      TIPLOC
                    </BUTOperatorChip>
                  </div>
                </div>
                {searchError && (
                  <p className="dep-history-inline-error" role="alert">{searchError}</p>
                )}
              </SidebarDropdownSection>

              <SidebarDropdownSection
                key={hasStationSelected ? 'datetime-station' : 'datetime-home'}
                title="Date and time"
                className="dep-datetime-section"
                defaultExpanded={!hasStationSelected}
              >
                <div className="dep-history-controls">
                  <button
                    type="button"
                    className="dep-operating-day-info-row"
                    onClick={() => setOperatingDayHelpOpen(true)}
                  >
                    <Info size={16} weight="regular" aria-hidden />
                    <span>Information</span>
                  </button>
                  <div className="dep-history-field">
                    <span className="dep-filter-label">Date</span>
                    <div className="dep-picker-shell">
                      <TXTINPBUTWideButton
                        id="dep-history-date-display"
                        value={isoDateToDdMmYyyy(historyDateDraft)}
                        placeholder="DD/MM/YYYY"
                        readOnly
                        tabIndex={-1}
                        showClear={false}
                        ariaLabel="Date"
                        colorVariant="primary"
                      />
                      <input
                        id="dep-history-date"
                        className="dep-native-picker-input"
                        type="date"
                        lang="en-GB"
                        value={historyDateDraft}
                        min={minPickerDateIso}
                        max={maxFutureDateIso}
                        aria-label="Choose date"
                        onChange={(event) => {
                          setHistoryDateDraft(event.target.value)
                          if (historyDateError) setHistoryDateError(null)
                        }}
                      />
                    </div>
                  </div>
                  <div className="dep-history-field">
                    <span className="dep-filter-label">Time</span>
                    <TXTINPBUTWideButton
                      id="dep-history-time"
                      type="time"
                      step={60}
                      lang="en-GB"
                      value={historyTimeDraft}
                      onChange={(value) => {
                        const next = normalizeClockHhmm(value)
                        setHistoryTimeDraft(next || value)
                        if (historyDateError) setHistoryDateError(null)
                      }}
                      showClear={false}
                      ariaLabel="Time"
                      colorVariant="primary"
                    />
                  </div>
                  <div className="dep-datetime-actions">
                    <BUTWideButton
                      width="fill"
                      instantAction
                      colorVariant="primary"
                      onClick={() => applyDateTimeFilter()}
                    >
                      Apply date/time
                    </BUTWideButton>
                    <BUTWideButton
                      width="fill"
                      instantAction
                      colorVariant="primary"
                      state={historyTime && historyTime === getLiveNowPartsUk().time ? 'pressed' : 'active'}
                      onClick={resetToLiveNow}
                    >
                      Live now
                    </BUTWideButton>
                  </div>
                  {historyDateError && (
                    <p className="dep-history-inline-error" role="alert">{historyDateError}</p>
                  )}
                </div>
              </SidebarDropdownSection>

              <SidebarDropdownSection title="Filters" defaultExpanded={false}>
                <div className="dep-filters-panel">
                  <div className="dep-control-group">
                    <span className="dep-filter-label">Window</span>
                    <BUTDDMList
                      items={WINDOW_OPTIONS.map((opt) => opt.label)}
                      filterName="Window"
                      selectionMode="single"
                      selectedPositions={[windowSelectedIndex]}
                      onSelectionChanged={(selectedPositions) => {
                        const idx = selectedPositions[0]
                        if (typeof idx !== 'number') return
                        const selectedOption = WINDOW_OPTIONS[idx]
                        if (!selectedOption) return
                        updateQuery((next) => {
                          next.set('hours', String(selectedOption.value))
                        })
                      }}
                      colorVariant="primary"
                    />
                  </div>

                  <div className="dep-control-group">
                    <span className="dep-filter-label">TOC</span>
                    <BUTDDMListActionDual
                      items={tocOptions}
                      filterName="TOCs"
                      selectionMode="multi"
                      selectedPositions={selectedTocs
                        .map((toc) => tocOptions.indexOf(toc))
                        .filter((index) => index >= 0)}
                      onSelectionChanged={(_, selectedItems) => {
                        setTocSelection(selectedItems.length > 0 ? selectedItems : null)
                      }}
                      colorVariant="primary"
                    />
                  </div>

                  <div className="dep-control-group">
                    <span className="dep-filter-label">Service type</span>
                    <BUTDDMListActionDual
                      items={serviceTypeOptions.map((type) => SERVICE_TYPE_LABELS[type])}
                      filterName="Service types"
                      selectionMode="multi"
                      selectedPositions={selectedServiceTypes
                        .map((type) => serviceTypeOptions.indexOf(type))
                        .filter((index) => index >= 0)}
                      onSelectionChanged={(_, selectedItems) => {
                        const selected = selectedItems
                          .map((label) => serviceTypeOptions.find((type) => SERVICE_TYPE_LABELS[type] === label))
                          .filter((value): value is DepartureServiceType => Boolean(value))
                        setTypeSelection(selected.length > 0 ? selected : null)
                      }}
                      colorVariant="primary"
                    />
                  </div>

                  {showDetailedInfo && boardMode === 'departures' && (
                    <div className="dep-control-group">
                      <span className="dep-filter-label">Stop mode</span>
                      <BUTDDMListActionDual
                        items={STOP_MODE_OPTIONS.map((mode) => STOP_MODE_LABELS[mode])}
                        filterName="Stop modes"
                        selectionMode="multi"
                        selectedPositions={selectedStopModes
                          .map((mode) => STOP_MODE_OPTIONS.indexOf(mode))
                          .filter((index) => index >= 0)}
                        onSelectionChanged={(_, selectedItems) => {
                          const selected = selectedItems
                            .map((label) => STOP_MODE_OPTIONS.find((mode) => STOP_MODE_LABELS[mode] === label))
                            .filter((value): value is StopModeFilter => Boolean(value))
                          setSelectedStopModes(selected)
                        }}
                        colorVariant="primary"
                      />
                    </div>
                  )}

                  <div className="dep-filters-footer">
                    <BUTWideButton
                      width="fill"
                      instantAction
                      colorVariant="primary"
                      onClick={refetch}
                      disabled={historicalMode && !historyDate}
                    >
                      Refresh
                    </BUTWideButton>
                  </div>
                </div>
              </SidebarDropdownSection>
            </SidebarPanel>
          </aside>

          <main className="browse-main dep-main">
            {!hasStationSelected && (
              <section className="dep-main-message">
                <h2>Choose a station to begin</h2>
                <p>
                  Search by station name, CRS, or TIPLOC, then pick a match from the list.
                </p>
              </section>
            )}

            {hasStationSelected && status === 'not-found' && (
              <section className="dep-main-message dep-main-message--error">
                <h2>Station not found</h2>
                <p>
                  No station matches <code>{code}</code>. Try a station name, 3-letter CRS
                  (e.g. <code>KGX</code>, <code>LDS</code>) or a TIPLOC
                  (e.g. <code>LEEDS</code>, <code>KNGX</code>).
                </p>
              </section>
            )}

            {hasStationSelected && status === 'error' && !data && (
              <section className="dep-main-message dep-main-message--error">
                <h2>{historicalMode ? 'Historical board unavailable' : 'Live board unavailable'}</h2>
                <p>{error}</p>
              </section>
            )}

            {hasStationSelected && status === 'loading' && !data && (
              <section className="dep-main-message">
                <div className="dep-loading-state" role="status" aria-live="polite">
                  <span className="dep-loading-spinner" aria-hidden="true" />
                  <p>
                    {historicalMode
                      ? `Loading actual times${historyDate ? ` for ${formatHeaderDate(historyDate)}` : ''}…`
                      : futureTimetableMode
                        ? 'Loading timetable data…'
                        : `Loading live ${boardMode === 'departures' ? 'departures' : 'arrivals'}…`}
                  </p>
                </div>
              </section>
            )}

            {hasStationSelected && data && (
              <>
                <KnowledgebaseIncidentsBanner />
                <StationMessages messages={data.messages || []} />

                {activeFilteredRows.length === 0 ? (
                  <section className="dep-main-message">
                    <p>
                      {boardMode === 'departures'
                        ? `No departures match the selected filters in the next ${data.windowHours} hour${data.windowHours === 1 ? '' : 's'}.`
                        : `No arrivals match the selected filters in the next ${data.windowHours} hour${data.windowHours === 1 ? '' : 's'}.`}
                    </p>
                  </section>
                ) : (
                  <div className="dep-cards" role="list">
                    {boardRows.map((row) => (
                      <DarwinDepartureRowCard
                        key={`${row.rid}-${row.movement ?? 'departure'}`}
                        row={row}
                        historicalMode={historicalMode}
                        code={code}
                        hours={hours}
                        historyDate={historyDate}
                        historyTime={historyTime}
                        detailedInfo={showDetailedInfo}
                        showFormation={showFormation}
                      />
                    ))}
                  </div>
                )}

                <footer className="dep-footer">
                  <span>Source: Network Rail Darwin Push Port</span>
                  <span className="dep-footer-sep" aria-hidden="true">·</span>
                  <DataLicenceAttribution />
                  <span className="dep-footer-sep" aria-hidden="true">·</span>
                  <span>Updated {new Date(data.updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour12: false })}</span>
                </footer>
              </>
            )}
          </main>
      </div>
      {operatingDayHelpOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="dep-operating-day-overlay"
              role="presentation"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOperatingDayHelpOpen(false)
              }}
            >
              <div
                className="dep-operating-day-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dep-operating-day-title"
              >
                <div className="dep-operating-day-dialog__header">
                  <h2 id="dep-operating-day-title">Railway operating day</h2>
                  <BUTCircleButton
                    type="button"
                    instantAction
                    colorVariant="primary"
                    ariaLabel="Close railway operating day information"
                    onClick={() => setOperatingDayHelpOpen(false)}
                    icon={<X size={16} weight="bold" aria-hidden />}
                  />
                </div>
                <div className="dep-operating-day-dialog__status" role="status">
                  {historyDate ? (
                    <>
                      <p>
                        <strong>Wall clock (London):</strong>{' '}
                        {formatHeaderDate(historyDate)}{historyTime ? ` · ${historyTime}` : ''}
                      </p>
                      {data?.historicalDate ? (
                        <p>
                          <strong>Darwin operating day:</strong> {formatHeaderDate(data.historicalDate)}
                          {historicalMode ? ' (historical)' : futureTimetableMode ? ' (timetable)' : ''}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p>
                      <strong>Live board · date:</strong> {formatHeaderDate(todayIsoDate)}
                    </p>
                  )}
                  <p>
                    <strong>Live now:</strong> {formatLiveNowUk()}
                  </p>
                </div>
                <p className="dep-operating-day-dialog__copy">
                  The railway day runs <strong>02:00 to 01:59</strong> (Europe/London). Tonight’s board
                  keeps running through midnight until 02:00. After 02:00 that is the next day’s timetable.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default DarwinDeparturesPage