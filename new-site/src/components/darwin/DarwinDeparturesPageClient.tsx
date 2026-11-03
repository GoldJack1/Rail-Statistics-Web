'use client'

import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Funnel, MagnifyingGlass, PencilSimple, SlidersHorizontal } from '@phosphor-icons/react'

import { useDepartures } from '@/hooks/useDepartures'
import type { DepartureRow, DepartureServiceType, DeparturesSnapshot } from '@/types/darwin'
import { useDarwinLocationLookup, useDarwinLocationSearch, type DarwinCatalogLocation, type DarwinLocationKind } from '@/hooks/useDarwinLocationSearch'
import { useStations } from '@/hooks/useStations'
import { departureNameQueryNeedsFullCatalog, filterDepartureNameResults } from '@/utils/departureNameSearch'
import { BackIcon } from '@/components/icons'
import { PageTopHeader, SidebarPanel } from '@/components/misc'
import { BUTBaseButton, BUTOperatorChip, BUTTwoButtonBar, BUTWideButton, TOGToggleVisited } from '@/components/buttons'
import { ServiceViewModeToggle } from '@/components/darwin/ServiceViewModeToggle'
import { BoardDatePicker, BoardTimePicker } from '@/components/darwin/BoardDateTimePickers'
import { SidePane } from '@/components/darwin/SidePane/SidePane'
import { useServiceViewMode } from '@/components/darwin/serviceViewMode'
import BUTDDMList from '@/components/buttons/ddm/BUTDDMList'
import BUTDDMListActionDual from '@/components/buttons/ddm/BUTDDMListActionDual'
import { DarwinServiceCard } from '@/components/cards'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import { StationMessages } from '@/components/darwin/StationMessages'
import { KnowledgebaseIncidentsBanner } from '@/components/darwin/KnowledgebaseIncidentsBanner'
import DarwinQueryEnvBanner from '@/components/darwin/DarwinQueryEnvBanner/DarwinQueryEnvBanner'
import { railwayOperatingDayIsoFromLondonParts, scheduledTimeInRailwayWindow, normalizeClockHhmm } from '@/utils/railwayOperatingDayUk'
import { paramAsString } from '@/utils/nextParams'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { parseHistoryDatesList } from '@/utils/normalizeRailCore'
import { peekHotHealth, peekHotHistoryDates } from '@/utils/darwinHotCache'
import { prefetchDarwinService } from '@/hooks/useServiceDetail'
import { goToServicePath } from '@/utils/serviceUrl'
import { boardDestinationLabel } from '@/utils/splitWorking'
import { formatLmTocName } from '@/utils/formatLmTocName'
import { isBetaSite } from '@/utils/localDevFlags'
import '@/styles/browsePageLayout.css'
import '@/app/departures/DarwinDeparturesPage.css'

type StopModeFilter = 'calling' | 'passing'
type BoardModeFilter = 'departures' | 'arrivals'
type BoardStatusFilter = 'on-time' | 'early' | 'delayed' | 'cancelled'
type StationSearchMode = 'name' | 'other' | 'crs' | 'tiploc'

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
const HEADER_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const HEADER_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

function ordinalDay(day: number): string {
  const mod100 = day % 100
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`
  switch (day % 10) {
    case 1: return `${day}st`
    case 2: return `${day}nd`
    case 3: return `${day}rd`
    default: return `${day}th`
  }
}

function formatBarDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return dateStr
  const monthName = HEADER_MONTHS[Number(match[2]) - 1]
  if (!monthName) return dateStr
  return `${match[3]} ${monthName} ${match[1]}`
}

function formatWindowDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return dateStr
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const weekday = HEADER_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  const monthName = HEADER_MONTHS_LONG[month - 1]
  if (!weekday || !monthName) return dateStr
  return `${weekday} ${ordinalDay(day)} ${monthName} ${year}`
}

function addHoursToClock(hhmm: string, hours: number): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!match) return hhmm
  const total = Number(match[1]) * 60 + Number(match[2]) + hours * 60
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function formatBoardWindow(dateIso: string, startHhmm: string, hours: number): string {
  return `${formatWindowDate(dateIso)}: ${startHhmm} - ${addHoursToClock(startHhmm, hours)}`
}

function formatHeaderDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) return dateStr
  const month = HEADER_MONTHS[Number(match[2]) - 1]
  if (!month) return dateStr
  return `${Number(match[3])} ${month} ${match[1]}`
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
  pastTimes: boolean
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
  pastTimes,
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
      : `${formatTime(row.scheduledAt)} to ${boardDestinationLabel(row)}`
  const ariaState = row.cancelled ? 'cancelled' : historicalMode ? 'historical snapshot' : 'live status'

  const onClick = useCallback(() => {
    const now = getLiveNowPartsUk()
    const frozen = Boolean(historyDate) && (historyDate !== now.date || (historyTime && historyTime !== now.time))
    const serviceDate = frozen ? historyDate : now.date
    const backQs = new URLSearchParams()
    backQs.set('hours', String(hours))
    if (frozen && serviceDate) backQs.set('date', serviceDate)
    if (frozen && historyTime) backQs.set('at', historyTime)
    prefetchDarwinService(row.rid, frozen ? historyDate : undefined)
    router.push(
      goToServicePath({
        id: row.uid || row.rid,
        date: serviceDate,
        from: `/departures/${encodeURIComponent(code)}?${backQs.toString()}`,
      }),
    )
  }, [router, historyDate, historyTime, code, hours, row.rid, row.uid])

  return (
    <div
      role="listitem"
      onPointerEnter={() => {
        if (!detailedInfo) return
        const now = getLiveNowPartsUk()
        const frozen = Boolean(historyDate) && (historyDate !== now.date || (historyTime && historyTime !== now.time))
        prefetchDarwinService(row.rid, frozen ? historyDate : undefined)
      }}
    >
      <DarwinServiceCard
        row={row}
        historicalMode={historicalMode}
        pastTimes={pastTimes}
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

function locationKindForMode(mode: StationSearchMode, query: string): DarwinLocationKind | undefined {
  if (mode === 'other') return 'other'
  if (mode === 'name' && !departureNameQueryNeedsFullCatalog(query)) return 'station'
  return undefined
}

function normalizeSearchInputForMode(raw: string, mode: StationSearchMode): string {
  if (mode === 'name' || mode === 'other') return raw
  if (mode === 'crs') return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
}

function searchPlaceholderForMode(mode: StationSearchMode): string {
  if (mode === 'crs') return 'CRS (3 letters) e.g. LDS'
  if (mode === 'tiploc') return 'TIPLOC (max 10) e.g. LEEDS'
  if (mode === 'other') return 'Junction, depot or yard e.g. Holbeck'
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
const STATUS_LABELS: Record<BoardStatusFilter, string> = {
  'on-time': 'On time',
  early: 'Early',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
}
const ALL_STATUSES = Object.keys(STATUS_LABELS) as BoardStatusFilter[]
const UNKNOWN_TOC_LABEL = 'Unknown'
const UNKNOWN_PLACE_LABEL = 'Unknown'

function tocFilterLabel(row: DepartureRow): string {
  const label = formatLmTocName(row.tocName, row.toc, row.originCrs, row.destinationCrs)
  return label && label.trim() ? label : UNKNOWN_TOC_LABEL
}

function rowStatus(row: DepartureRow): BoardStatusFilter {
  if (row.cancelled) return 'cancelled'
  if (row.unknownDelay || row.manualUnknownDelay) return 'delayed'
  if (typeof row.delayMinutes === 'number') {
    if (row.delayMinutes > 0) return 'delayed'
    if (row.delayMinutes < 0) return 'early'
  }
  return 'on-time'
}

function platformFilterLabel(row: DepartureRow, historicalMode: boolean): string {
  if (row.serviceType === 'rail-replacement') return 'Bus stop'
  const number = row.livePlatform?.trim() || row.platform?.trim()
  if (number) return `Platform ${number}`
  return historicalMode ? 'Platform NA' : 'Platform TBC'
}

function placeFilterLabel(row: DepartureRow, boardMode: BoardModeFilter): string {
  if (boardMode === 'arrivals') {
    const origin = row.originName?.trim() || row.origin?.trim()
    return origin || UNKNOWN_PLACE_LABEL
  }
  return boardDestinationLabel(row).trim() || UNKNOWN_PLACE_LABEL
}

function comparePlatformLabels(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
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
  const [platformSelection, setPlatformSelection] = useState<string[] | null>(null)
  const [statusSelection, setStatusSelection] = useState<BoardStatusFilter[] | null>(null)
  const [placeSelection, setPlaceSelection] = useState<string[] | null>(null)
  const [selectedStopModes, setSelectedStopModes] = useState<StopModeFilter[]>(STOP_MODE_OPTIONS)
  const [viewMode, setViewMode] = useServiceViewMode()
  const showDetailedInfo = viewMode === 'detailed'
  const [showFormation, setShowFormation] = useState(true)
  const [boardMode, setBoardMode] = useState<BoardModeFilter>('departures')
  const [historyDates, setHistoryDates] = useState<string[]>(() => peekHotHistoryDates() || [])
  const [liveClockReady, setLiveClockReady] = useState(false)
  const { stations } = useStations({ defer: false })
  const gbnrStations = useMemo(
    () => stations.filter(
      (station) => station.sourceCollectionId === 'stations_gbnr'
        || String(station.stnarea || '').toUpperCase() === 'GBNR',
    ),
    [stations],
  )
  const catalogHits = useDarwinLocationSearch(searchInput, locationKindForMode(searchMode, searchInput))
  const nameSearchHits = useMemo(
    () => filterDepartureNameResults(searchInput, gbnrStations, catalogHits, gbnrStations.length > 0),
    [searchInput, gbnrStations, catalogHits],
  )
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
  const [showLiveTime, setShowLiveTime] = useState(!historyDate && !historyTime)
  const [openPane, setOpenPane] = useState<'filters' | 'view' | 'date' | 'time' | 'lookup' | null>(null)
  const [isMobileLayout, setIsMobileLayout] = useState(false)
  const pickerDirtyRef = useRef(false)
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
    setShowLiveTime(!historyDate && !historyTime)
  }, [historyDate, historyTime])

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
    cisMode: isBetaSite() ? false : viewMode === 'simple',
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
    if (searchMode === 'name' || searchMode === 'other') {
      const namedHits = searchMode === 'name' ? nameSearchHits : catalogHits
      next = namedHits[0]?.tiploc || namedHits[0]?.crs || null
      if (!next) {
        setSearchError(
          searchMode === 'other'
            ? 'No junction, depot or other location match found.'
            : 'No station name match found. Try the full station name or switch mode.',
        )
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

  const selectedTocs = tocSelection && tocSelection.length > 0 ? tocSelection : tocOptions
  const historyWindowStart = historyTime || (datedBoard ? '02:00' : getLiveNowPartsUk().time)
  const serviceTypeOptions = useMemo(() => {
    if (!data) return []
    const rows = boardMode === 'departures' ? data.departures : (data.arrivals ?? [])
    const sliceInUi = historicalMode || futureTimetableMode || (datedBoard && !historyTime)
    const present = new Set<DepartureServiceType>()
    for (const row of rows) {
      if (boardMode === 'departures' && !showDetailedInfo && row.isPassing) continue
      if (sliceInUi && !scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)) continue
      present.add(row.serviceType || 'other')
    }
    return ALL_SERVICE_TYPES.filter((type) => present.has(type))
  }, [data, boardMode, showDetailedInfo, historicalMode, futureTimetableMode, datedBoard, historyTime, historyWindowStart, hours])
  const selectedServiceTypes = typeSelection && typeSelection.length > 0
    ? typeSelection.filter((type) => serviceTypeOptions.includes(type))
    : serviceTypeOptions

  const visibleBoardRows = useMemo(() => {
    if (!data) return []
    const rows = boardMode === 'departures' ? data.departures : (data.arrivals ?? [])
    const sliceInUi = historicalMode || futureTimetableMode || (datedBoard && !historyTime)
    return rows.filter((row) => {
      if (boardMode === 'departures' && !showDetailedInfo && row.isPassing) return false
      if (sliceInUi && !scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)) return false
      return true
    })
  }, [data, boardMode, showDetailedInfo, historicalMode, futureTimetableMode, datedBoard, historyTime, historyWindowStart, hours])

  const platformOptions = useMemo(() => {
    return Array.from(new Set(visibleBoardRows.map((row) => platformFilterLabel(row, historicalMode))))
      .sort(comparePlatformLabels)
  }, [visibleBoardRows, historicalMode])
  const selectedPlatforms = platformSelection && platformSelection.length > 0
    ? platformSelection.filter((label) => platformOptions.includes(label))
    : platformOptions

  const statusOptions = useMemo(() => {
    const present = new Set(visibleBoardRows.map((row) => rowStatus(row)))
    return ALL_STATUSES.filter((status) => present.has(status))
  }, [visibleBoardRows])
  const selectedStatuses = statusSelection && statusSelection.length > 0
    ? statusSelection.filter((status) => statusOptions.includes(status))
    : statusOptions

  const placeOptions = useMemo(() => {
    return Array.from(new Set(visibleBoardRows.map((row) => placeFilterLabel(row, boardMode))))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [visibleBoardRows, boardMode])
  const selectedPlaces = placeSelection && placeSelection.length > 0
    ? placeSelection.filter((label) => placeOptions.includes(label))
    : placeOptions

  useEffect(() => {
    setTocSelection(null)
    setTypeSelection(null)
    setPlatformSelection(null)
    setStatusSelection(null)
    setPlaceSelection(null)
  }, [code, hours, historyDate, historyTime, boardMode])

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
        : stopMode === 'calling'
      const sliceInUi = historicalMode || futureTimetableMode || (datedBoard && !historyTime)
      const timeMatch = sliceInUi
        ? scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)
        : true
      const platformMatch = selectedPlatforms.includes(platformFilterLabel(row, historicalMode))
      const statusMatch = selectedStatuses.includes(rowStatus(row))
      const placeMatch = selectedPlaces.includes(placeFilterLabel(row, 'departures'))
      return tocMatch && serviceTypeMatch && stopModeMatch && timeMatch && platformMatch && statusMatch && placeMatch
    })
  }, [data, selectedTocs, selectedServiceTypes, selectedStopModes, selectedPlatforms, selectedStatuses, selectedPlaces, showDetailedInfo, datedBoard, historyTime, historyWindowStart, hours, historicalMode, futureTimetableMode])

  const filteredArrivals = useMemo(() => {
    if (!data) return []
    const arrivals = data.arrivals ?? []
    return arrivals.filter((row) => {
      const tocLabel = tocFilterLabel(row)
      const tocMatch = selectedTocs.includes(tocLabel)
      const rowServiceType = row.serviceType || 'other'
      const serviceTypeMatch = selectedServiceTypes.includes(rowServiceType)
      const sliceInUi = historicalMode || futureTimetableMode || (datedBoard && !historyTime)
      const timeMatch = sliceInUi
        ? scheduledTimeInRailwayWindow(row.scheduledTime, historyWindowStart, hours)
        : true
      const platformMatch = selectedPlatforms.includes(platformFilterLabel(row, historicalMode))
      const statusMatch = selectedStatuses.includes(rowStatus(row))
      const placeMatch = selectedPlaces.includes(placeFilterLabel(row, 'arrivals'))
      return tocMatch && serviceTypeMatch && timeMatch && platformMatch && statusMatch && placeMatch
    })
  }, [data, selectedTocs, selectedServiceTypes, selectedPlatforms, selectedStatuses, selectedPlaces, datedBoard, historyTime, historyWindowStart, hours, historicalMode, futureTimetableMode])

  const activeFilteredRows =
    boardMode === 'departures' ? filteredDepartures : filteredArrivals

  const boardRows = activeFilteredRows

  const filteredCounts = useMemo(
    () => ({ rows: activeFilteredRows.length }),
    [activeFilteredRows],
  )

  const subtitle = useMemo<React.ReactNode>(() => {
    const movementWord = boardMode === 'departures' ? 'departures' : 'arrivals'
    if (!hasStationSelected) return 'Search by station name, CRS, or TIPLOC'

    const liveParts = !datedBoard && liveClockReady ? getLiveNowPartsUk() : null
    const windowDate = historyDate || liveParts?.date || ''
    const windowStart = historyTime || (datedBoard ? historyWindowStart : liveParts?.time || '')
    const windowHeading = windowDate && windowStart
      ? formatBoardWindow(windowDate, windowStart, hours)
      : null
    const hourLabel = `${hours} hour${hours === 1 ? '' : 's'}`
    const updated = ageMs == null ? 'updated just now' : `updated ${formatAge(ageMs)}`
    const countLine = data
      ? datedBoard
        ? `${filteredCounts.rows} ${movementWord} from ${historyWindowStart} for ${hourLabel}, ${updated}`
        : `${filteredCounts.rows} ${movementWord} in the next ${hourLabel}, ${updated}`
      : null

    if (status === 'ok' || status === 'stale') {
      if (!windowHeading && !countLine) return ''
      return (
        <>
          {windowHeading ? <span className="dep-subtitle__status">{windowHeading}</span> : null}
          {windowHeading && countLine ? '\n' : null}
          {countLine ? <span className="dep-subtitle__count">{countLine}</span> : null}
        </>
      )
    }
    if (status === 'loading') {
      const loading = `Loading ${movementWord}…`
      return windowHeading ? (
        <>
          <span className="dep-subtitle__status">{windowHeading}</span>
          {'\n'}
          <span className="dep-subtitle__status">{loading}</span>
        </>
      ) : <span className="dep-subtitle__status">{loading}</span>
    }
    if (status === 'error') return <span className="dep-subtitle__status">{error ? `Error: ${error}` : 'Board data unavailable'}</span>
    if (status === 'not-found') return <span className="dep-subtitle__status">Unknown station</span>
    return ''
  }, [status, error, ageMs, hasStationSelected, data, filteredCounts.rows, boardMode, datedBoard, historyDate, historyTime, historyWindowStart, hours, liveClockReady])

  const stationSuggestions = useMemo(() => {
    const rows = searchMode === 'name' ? nameSearchHits : catalogHits
    return rows.map(catalogToSearchHit)
  }, [catalogHits, nameSearchHits, searchMode])

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
  const earliestBoardDate = minPickerDateIso < minLookbackDateIso ? minPickerDateIso : minLookbackDateIso

  const applyDateTimeFilter = (dateRaw = historyDateDraft, timeRaw = historyTimeDraft) => {
    const dateValue = dateRaw.trim()
    const normalizedTime = normalizeTimeInput(timeRaw)
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    const timeOk = normalizedTime !== null
    if (!dateOk) {
      setHistoryDateError('Choose a date.')
      return false
    }
    if (!timeOk) {
      setHistoryDateError('Choose a time.')
      return false
    }
    if (dateValue > maxFutureDateIso) {
      setHistoryDateError(`Future timetable view currently supports up to ${formatHeaderDate(maxFutureDateIso)}.`)
      return false
    }
    const lookbackOk = dateValue >= minLookbackDateIso
    if (dateValue < todayIsoDate && !availableHistoryDatesSet.has(dateValue) && !lookbackOk) {
      setHistoryDateError('That date is not available in historical snapshots.')
      return false
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
    return true
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const sync = () => {
      const mobile = media.matches
      setIsMobileLayout(mobile)
      if (!mobile) setOpenPane((current) => (current === 'lookup' ? null : current))
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  const requestPane = (next: 'filters' | 'view' | 'date' | 'time' | 'lookup' | null) => {
    if ((openPane === 'date' || openPane === 'time') && next !== openPane && pickerDirtyRef.current) {
      if (!applyDateTimeFilter()) return
    }
    if (next !== 'date' && next !== 'time') pickerDirtyRef.current = false
    setOpenPane(next)
  }

  const markPickerDirty = () => {
    pickerDirtyRef.current = true
  }

  const isBoardDateEnabled = (dateValue: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return false
    if (dateValue > maxFutureDateIso || dateValue < earliestBoardDate) return false
    if (dateValue < todayIsoDate && dateValue < minLookbackDateIso && !availableHistoryDatesSet.has(dateValue)) return false
    return true
  }

  const resetToLiveNow = () => {
    const now = getLiveNowPartsUk()
    pickerDirtyRef.current = false
    setShowLiveTime(true)
    setHistoryDateDraft(now.date)
    setHistoryTimeDraft(now.time)
    setHistoryDateError(null)
    updateQuery((next) => {
      next.delete('date')
      next.delete('at')
    })
  }

  const goToToday = () => {
    const now = getLiveNowPartsUk()
    setHistoryDateError(null)
    setHistoryDateDraft(now.date)
    const normalizedTime = normalizeTimeInput(historyTimeDraft)
    if (showLiveTime || normalizedTime === now.time) {
      resetToLiveNow()
      return
    }
    pickerDirtyRef.current = false
    setShowLiveTime(false)
    applyDateTimeFilter(now.date, historyTimeDraft)
  }

  const lookupControls = (
    <div className="dep-sidebar-stack">
      <div className="dep-history-controls">
        <div className="dep-sidebar-field">
        <span className="dep-filter-label">Date and time</span>
        <div className="dep-datetime-bar">
          <div className="dep-datetime-bar__split">
            <BUTBaseButton
              type="button"
              variant="wide"
              shape="left-rounded"
              width="hug"
              instantAction
              colorVariant="primary"
              className="dep-datetime-bar__time"
              pressed={openPane === 'time'}
              ariaLabel={showLiveTime ? 'Time Now' : `Time ${historyTimeDraft}`}
              onClick={() => requestPane('time')}
            >
              {showLiveTime ? 'Now' : historyTimeDraft}
            </BUTBaseButton>
            <BUTBaseButton
              type="button"
              variant="wide"
              shape="right-rounded"
              width="fill"
              instantAction
              colorVariant="primary"
              className="dep-datetime-bar__date"
              pressed={openPane === 'date'}
              ariaLabel={`Date ${formatWindowDate(historyDateDraft)}`}
              onClick={() => requestPane('date')}
            >
              {formatBarDate(historyDateDraft)}
            </BUTBaseButton>
          </div>
        </div>
        </div>
        {historyDateError && openPane !== 'date' && openPane !== 'time' && (
          <p className="dep-history-inline-error" role="alert">{historyDateError}</p>
        )}
      </div>
      <div className="dep-sidebar-search">
      <div className="dep-sidebar-field">
      <span className="dep-filter-label">Search</span>
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
          <div className="tickets-station-suggestions" role="listbox" aria-label={searchMode === 'other' ? 'Location suggestions' : 'Station suggestions'}>
            {stationSuggestions.map((station, index) => {
              const isLast = index === stationSuggestions.length - 1
              const codeLabel =
                searchMode === 'tiploc' || searchMode === 'other'
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
            state={searchMode === 'other' ? 'pressed' : 'active'}
            onClick={() => setSearchModeAndFocus('other')}
            aria-label="Search junctions, depots and other locations"
          >
            Other
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
      </div>
    </div>
  )

  return (
    <div className="browse-page darwin-departures-shell">
      <DarwinQueryEnvBanner />
      <PageTopHeader
        title={stationLabel}
        subtitle={subtitle}
        className={`darwin-departures-header darwin-departures-header--${status}`}
        actionContent={(
          <>
            <div className="dep-header-actions">
              {from ? (
                <BUTWideButton
                  width="hug"
                  icon={<BackIcon />}
                  onClick={() => router.push(from)}
                >
                  Back
                </BUTWideButton>
              ) : null}
              <BUTWideButton
                type="button"
                width="hug"
                instantAction
                icon={<SlidersHorizontal size={16} weight="bold" aria-hidden />}
                ariaLabel="View settings"
                pressed={openPane === 'view'}
                onClick={() => requestPane('view')}
              >
                View settings
              </BUTWideButton>
              <BUTWideButton
                type="button"
                width="hug"
                instantAction
                icon={<Funnel size={16} weight="bold" aria-hidden />}
                ariaLabel="Filters"
                pressed={openPane === 'filters'}
                onClick={() => requestPane('filters')}
              >
                Filters
              </BUTWideButton>
              <div className="dep-header-edit">
                <BUTWideButton
                  type="button"
                  width="hug"
                  instantAction
                  icon={<PencilSimple size={16} weight="bold" aria-hidden />}
                  ariaLabel="Edit station, date and time"
                  pressed={openPane === 'lookup'}
                  onClick={() => requestPane('lookup')}
                >
                  Edit station, date & time
                </BUTWideButton>
              </div>
            </div>
          </>
        )}
      />

      <div className="browse-page-content">
          <aside className="browse-sidebar" aria-label="Board controls">
            {!isMobileLayout && (
            <SidebarPanel className="browse-sidebar-panel dep-sidebar-panel">
              {lookupControls}
            </SidebarPanel>
            )}
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
                        pastTimes={historicalMode || timedCurrentDayMode}
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
                  <span>
                    Live times and platforms come from the Network Rail Darwin Push Port.
                    Signalling actuals come from Network Rail TRUST, where shown.
                  </span>
                  <span className="dep-footer-sep" aria-hidden="true">·</span>
                  <span>Contains public sector information licensed under the Open Government Licence v3.0.</span>
                  <span className="dep-footer-sep" aria-hidden="true">·</span>
                  <span>Updated {new Date(data.updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour12: false })}</span>
                </footer>
              </>
            )}
          </main>
      </div>
      <SidePane
        open={openPane !== null}
        title={openPane === 'view' ? 'View settings' : openPane === 'date' ? 'Date' : openPane === 'time' ? 'Time' : openPane === 'lookup' ? 'Search' : 'Filters'}
        onClose={() => requestPane(null)}
        footer={openPane === 'time' ? (
          <BUTWideButton
            width="fill"
            instantAction
            colorVariant="primary"
            state={showLiveTime ? 'pressed' : 'active'}
            onClick={resetToLiveNow}
          >
            Live now
          </BUTWideButton>
        ) : openPane === 'date' ? (
          <BUTWideButton
            width="fill"
            instantAction
            colorVariant="primary"
            state={historyDateDraft === getLiveNowPartsUk().date ? 'pressed' : 'active'}
            onClick={goToToday}
          >
            Today
          </BUTWideButton>
        ) : null}
      >
        {openPane === 'lookup' ? lookupControls : openPane === 'view' ? (
        <div className="dep-view-settings">
          <div className="dep-control-group">
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
          </div>
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
        ) : openPane === 'date' ? (
        <div className="dep-picker-pane">
          <BoardDatePicker
            value={historyDateDraft}
            min={earliestBoardDate}
            max={maxFutureDateIso}
            isDateEnabled={isBoardDateEnabled}
            onChange={(iso) => {
              markPickerDirty()
              setShowLiveTime(false)
              setHistoryDateDraft(iso)
              if (historyDateError) setHistoryDateError(null)
            }}
          />
          {historyDateError && (
            <p className="dep-history-inline-error" role="alert">{historyDateError}</p>
          )}
        </div>
        ) : openPane === 'time' ? (
        <div className="dep-picker-pane">
          <BoardTimePicker
            value={historyTimeDraft}
            onChange={(hhmm) => {
              markPickerDirty()
              setShowLiveTime(false)
              setHistoryTimeDraft(hhmm)
              if (historyDateError) setHistoryDateError(null)
            }}
          />
          {historyDateError && (
            <p className="dep-history-inline-error" role="alert">{historyDateError}</p>
          )}
        </div>
        ) : (
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

          {platformOptions.length > 0 && (
            <div className="dep-control-group">
              <span className="dep-filter-label">Platform</span>
              <BUTDDMListActionDual
                items={platformOptions}
                filterName="Platforms"
                selectionMode="multi"
                selectedPositions={selectedPlatforms
                  .map((label) => platformOptions.indexOf(label))
                  .filter((index) => index >= 0)}
                onSelectionChanged={(_, selectedItems) => {
                  setPlatformSelection(selectedItems.length > 0 ? selectedItems : null)
                }}
                colorVariant="primary"
              />
            </div>
          )}

          {statusOptions.length > 0 && (
            <div className="dep-control-group">
              <span className="dep-filter-label">Status</span>
              <BUTDDMListActionDual
                items={statusOptions.map((status) => STATUS_LABELS[status])}
                filterName="Statuses"
                selectionMode="multi"
                selectedPositions={selectedStatuses
                  .map((status) => statusOptions.indexOf(status))
                  .filter((index) => index >= 0)}
                onSelectionChanged={(_, selectedItems) => {
                  const selected = selectedItems
                    .map((label) => statusOptions.find((status) => STATUS_LABELS[status] === label))
                    .filter((value): value is BoardStatusFilter => Boolean(value))
                  setStatusSelection(selected.length > 0 ? selected : null)
                }}
                colorVariant="primary"
              />
            </div>
          )}

          {placeOptions.length > 0 && (
            <div className="dep-control-group">
              <span className="dep-filter-label">{boardMode === 'departures' ? 'Destination' : 'Origin'}</span>
              <BUTDDMListActionDual
                items={placeOptions}
                filterName={boardMode === 'departures' ? 'Destinations' : 'Origins'}
                selectionMode="multi"
                selectedPositions={selectedPlaces
                  .map((label) => placeOptions.indexOf(label))
                  .filter((index) => index >= 0)}
                onSelectionChanged={(_, selectedItems) => {
                  setPlaceSelection(selectedItems.length > 0 ? selectedItems : null)
                }}
                colorVariant="primary"
              />
            </div>
          )}

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
        )}
      </SidePane>
    </div>
  )
}

export default DarwinDeparturesPage