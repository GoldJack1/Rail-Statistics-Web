'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { BUTWideButton } from '@/components/buttons'
import { DarwinServiceCard, TextCard } from '@/components/cards'
import { PageTopHeader, SidebarDropdownSection, SidebarPanel } from '@/components/misc'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import TXTINPBUTWideButton from '@/components/textInputButtons/plain/TXTINPBUTWideButton'
import { applyBoardFormationOverlay, overlayKeyForRow, useBoardCoachLoading } from '@/hooks/useBoardCoachLoading'
import { useStations } from '@/hooks/useStations'
import type { BashPlanHop, BashPlanLeg, BashPlanResult, DepartureRow } from '@/types/darwin'
import type { Station } from '@/types'
import { exportBashPlanPdf } from '@/utils/exportBashPlanPdf'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { filterStationsLikeFaresSearch } from '@/utils/darwinStationFaresSearch'
import { railwayOperatingDayIsoFromLondonParts } from '@/utils/railwayOperatingDayUk'
import '@/styles/browsePageLayout.css'
import '@/app/bash-planner/BashPlannerPage.css'

const MAX_STATIONS = 12

type Picked = { crs: string; name: string }

function isWalkLeg(leg: { rid: string; trainId: string }) {
  return leg.rid === '__WALK__' || leg.trainId === 'Walk'
}

function hopKicker(hop: BashPlanHop): string {
  const arrow = `${hop.fromName} → ${hop.toName}`
  if (hop.legs.length > 0 && hop.legs.every(isWalkLeg)) return `Walk · ${arrow}`
  return arrow
}

function minutesBetween(fromTime: string, toTime: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }
  const from = parse(fromTime)
  const to = parse(toTime)
  if (from == null || to == null) return null
  let delta = to - from
  if (delta < 0) delta += 1440
  return delta
}

function minutesPhrase(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'Minute' : 'Minutes'}`
}

function platformLabel(platform?: string | null): string | null {
  const value = String(platform || '').trim()
  if (!value) return null
  return /^platform\b/i.test(value) ? value : `Platform ${value}`
}

function travelAlightTitle(args: { dep: string; arr: string; name: string; crs: string }): string {
  const dest = `${args.name} (${args.crs})`
  const travel = minutesBetween(args.dep, args.arr)
  if (travel == null) return `Alight at ${dest} at ${args.arr}`
  return `Travel for ${minutesPhrase(travel)}, then alight at ${dest} at ${args.arr}`
}

function connectionDescription(args: {
  fromPlat?: string | null
  toPlat?: string | null
  waitMin?: number | null
}): string | null {
  const fromLabel = platformLabel(args.fromPlat)
  const toLabel = platformLabel(args.toPlat)
  const wait = typeof args.waitMin === 'number' && args.waitMin >= 0
    ? `(You have ${minutesPhrase(args.waitMin)} to make this connection)`
    : null
  if (fromLabel && toLabel && fromLabel.toLowerCase() !== toLabel.toLowerCase()) {
    return `Then change from ${fromLabel} to ${toLabel}.${wait ? ` ${wait}` : ''}`
  }
  if (fromLabel && toLabel) {
    return `Stay on ${toLabel}.${wait ? ` ${wait}` : ''}`
  }
  if (wait) return `Then make your connection. ${wait}`
  return null
}

function walkTitle(leg: BashPlanLeg): string {
  return `Walk from ${leg.fromName} (${leg.fromCrs}) to ${leg.toName} (${leg.toCrs})`
}

function walkDescription(
  leg: BashPlanLeg,
  destArr: string,
  connection: { fromPlat?: string | null; toPlat?: string | null; waitMin?: number | null } | null,
): React.ReactNode {
  const mins = minutesBetween(leg.dep, destArr)
  const allow = mins != null ? `Allow ${minutesPhrase(mins)}.` : 'Walk between the two stations.'
  const times = `Leave ${leg.fromName} at ${leg.dep} and arrive at ${leg.toName} at ${destArr}.`
  const plat = platformLabel(connection?.toPlat)
  const wait = typeof connection?.waitMin === 'number' && connection.waitMin >= 0
    ? minutesPhrase(connection.waitMin)
    : null
  let next: string | null = null
  if (plat && wait) next = `Then board from ${plat}. (You have ${wait} after walking.)`
  else if (plat) next = `Then board from ${plat}.`
  else if (wait) next = `Then board your next train. (You have ${wait} after walking.)`
  return (
    <>
      {`${allow} ${times}`}
      {next ? (
        <>
          <br />
          {next}
        </>
      ) : null}
    </>
  )
}

function nextConnection(
  hops: BashPlanHop[],
  hopIndex: number,
  hop: BashPlanHop,
  legIndex: number,
  leg: BashPlanLeg,
): { fromPlat?: string | null; toPlat?: string | null; waitMin?: number | null } | null {
  const nextLeg = hop.legs[legIndex + 1]
  if (nextLeg) {
    return {
      fromPlat: leg.toPlat,
      toPlat: nextLeg.fromPlat,
      waitMin: minutesBetween(leg.arr, nextLeg.dep),
    }
  }
  const nextHop = hops[hopIndex + 1]
  if (!nextHop) return null
  return {
    fromPlat: hop.alightPlatform || leg.toPlat,
    toPlat: nextHop.boardPlatform || nextHop.legs[0]?.fromPlat,
    waitMin: nextHop.waitMin,
  }
}

function londonNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const pick = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  const year = Number(pick('year'))
  const month = Number(pick('month'))
  const day = Number(pick('day'))
  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))
  return {
    date: railwayOperatingDayIsoFromLondonParts(year, month, day, hour, minute),
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  }
}

function stationCrs(station: Station): string | null {
  const crs = (station.crsCode || '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(crs) ? crs : null
}

function StationSuggestList({
  stations,
  onPick,
}: {
  stations: Station[]
  onPick: (station: Station) => void
}) {
  if (stations.length === 0) return null
  return (
    <ul className="bash-suggest-list">
      {stations.map((station) => {
        const crs = stationCrs(station)
        if (!crs) return null
        return (
          <li key={`${station.id}-${crs}`}>
            <button type="button" onClick={() => onPick(station)}>
              {station.stationName}
              <span className="bash-suggest-code">{crs}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

const BashPlannerPageClient: React.FC = () => {
  const router = useRouter()
  const now = useMemo(() => londonNow(), [])
  const minDate = useMemo(() => {
    const d = new Date(`${now.date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }, [now.date])
  const [maxDate, setMaxDate] = useState(() => {
    const d = new Date(`${now.date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  useEffect(() => {
    let cancelled = false
    const loadWindow = async () => {
      try {
        const res = await fetchDarwin('/api/darwin/health')
        if (!res.ok) return
        const body = await res.json() as { timetableWindow?: { maxDate?: string } }
        const max = body?.timetableWindow?.maxDate
        if (!cancelled && typeof max === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(max)) {
          setMaxDate(max)
        }
      } catch {
        // Keep the 30-day fallback until the daemon reports the CIF horizon.
      }
    }
    void loadWindow()
    return () => {
      cancelled = true
    }
  }, [])
  const { stations } = useStations()
  const gbnr = useMemo(
    () =>
      stations.filter(
        (s) =>
          s.sourceCollectionId === 'stations_gbnr' ||
          String(s.stnarea || '').toUpperCase() === 'GBNR',
      ),
    [stations],
  )

  const [visitQuery, setVisitQuery] = useState('')
  const [startQuery, setStartQuery] = useState('')
  const [endQuery, setEndQuery] = useState('')
  const [visit, setVisit] = useState<Picked[]>([])
  const [start, setStart] = useState<Picked | null>(null)
  const [end, setEnd] = useState<Picked | null>(null)
  const [startTouched, setStartTouched] = useState(false)
  const [endTouched, setEndTouched] = useState(false)
  const [date, setDate] = useState(now.date)
  const [time, setTime] = useState(now.time)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BashPlanResult | null>(null)

  const visitSuggestions = filterStationsLikeFaresSearch(gbnr, visitQuery)
  const startSuggestions = filterStationsLikeFaresSearch(gbnr, startQuery)
  const endSuggestions = filterStationsLikeFaresSearch(gbnr, endQuery)

  const addVisit = (station: Station) => {
    const crs = stationCrs(station)
    if (!crs) return
    const picked = { crs, name: station.stationName }
    setVisit((prev) => {
      if (prev.some((p) => p.crs === crs)) return prev
      if (prev.length >= MAX_STATIONS) return prev
      const next = [...prev, picked]
      if (!startTouched) setStart(next[0])
      if (!endTouched) setEnd(picked)
      return next
    })
    setVisitQuery('')
  }

  const removeVisit = (crs: string) => {
    const next = visit.filter((p) => p.crs !== crs)
    setVisit(next)
    if (!startTouched || start?.crs === crs) {
      setStartTouched(false)
      setStart(next[0] || null)
    }
    if (!endTouched || end?.crs === crs) {
      setEndTouched(false)
      setEnd(next[next.length - 1] || null)
    }
  }

  const uniqueCount = useMemo(() => {
    const set = new Set(visit.map((v) => v.crs))
    if (start) set.add(start.crs)
    if (end) set.add(end.crs)
    return set.size
  }, [visit, start, end])

  const liveToday = Boolean(result?.date && result.date === now.date)
  const bashBoardRows = useMemo(() => {
    const rows: DepartureRow[] = []
    for (const hop of result?.hops || []) {
      for (const leg of hop.legs || []) {
        if (leg.board) rows.push(leg.board)
      }
    }
    return rows
  }, [result])
  const formationOverlays = useBoardCoachLoading(bashBoardRows, liveToday)

  const runPlan = async () => {
    setError(null)
    if (!start || !end) {
      setError('Choose a start and end station.')
      return
    }
    if (visit.length === 0) {
      setError('Add stations to visit.')
      return
    }
    if (uniqueCount > MAX_STATIONS) {
      setError(`At most ${MAX_STATIONS} stations including start and end.`)
      return
    }
    setPlanning(true)
    setResult(null)
    try {
      const res = await fetchDarwin('/api/darwin/plan/bash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          at: time,
          start: start.crs,
          end: end.crs,
          visit: visit.map((v) => v.crs),
        }),
      })
      const payload = (await res.json()) as BashPlanResult
      if (!res.ok || !payload.ok) {
        setError(payload.error || `Could not plan (${res.status})`)
        setResult(payload.ok ? payload : null)
        return
      }
      setResult(payload)
    } catch (e) {
      setError((e as Error)?.message || 'Could not reach Darwin.')
    } finally {
      setPlanning(false)
    }
  }

  return (
    <div className="browse-page">
      <PageTopHeader
        title="Station bash planner"
        subtitle="Alight at every listed GB National Rail station. The plan waits 5 minutes, then takes the next train in any direction."
      />
      <div className="browse-page-content">
        <aside className="browse-sidebar" aria-label="Bash planner">
          <SidebarPanel className="browse-sidebar-panel">
            <SidebarDropdownSection title="Stations to visit">
              <TXTINPBUTIconWideButtonSearch
                id="bash-visit-search"
                icon={<MagnifyingGlass size={16} aria-hidden />}
                value={visitQuery}
                onChange={setVisitQuery}
                onClear={() => setVisitQuery('')}
                placeholder="Add a station, e.g. Leeds"
                className="search-input-shell"
                colorVariant="primary"
                showClear
              />
              <StationSuggestList stations={visitSuggestions} onPick={addVisit} />
              {visit.length > 0 ? (
                <div className="bash-chip-row" style={{ marginTop: 12 }}>
                  {visit.map((item) => (
                    <span key={item.crs} className="bash-chip">
                      {item.name} ({item.crs})
                      <button type="button" className="bash-chip-link" onClick={() => {
                        setStartTouched(true)
                        setStart(item)
                      }}>
                        Start
                      </button>
                      <button type="button" className="bash-chip-link" onClick={() => {
                        setEndTouched(true)
                        setEnd(item)
                      }}>
                        End
                      </button>
                      <button type="button" aria-label={`Remove ${item.name}`} onClick={() => removeVisit(item.crs)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </SidebarDropdownSection>

            <SidebarDropdownSection title="Start and end">
              <div className="bash-filter-group">
                <p className="bash-filter-label">Start</p>
                <TXTINPBUTIconWideButtonSearch
                  id="bash-start-search"
                  icon={<MagnifyingGlass size={16} aria-hidden />}
                  value={start ? `${start.name} (${start.crs})` : startQuery}
                  onChange={(value) => {
                    setStartTouched(true)
                    setStart(null)
                    setStartQuery(value)
                  }}
                  onClear={() => {
                    setStartTouched(false)
                    setStart(visit[0] || null)
                    setStartQuery('')
                  }}
                  placeholder="First visit, or search"
                  className="search-input-shell"
                  colorVariant="primary"
                  showClear
                />
                {!start ? <StationSuggestList stations={startSuggestions} onPick={(s) => {
                  const crs = stationCrs(s)
                  if (!crs) return
                  setStartTouched(true)
                  setStart({ crs, name: s.stationName })
                  setStartQuery('')
                }} /> : null}
              </div>
              <div className="bash-filter-group">
                <p className="bash-filter-label">End</p>
                <TXTINPBUTIconWideButtonSearch
                  id="bash-end-search"
                  icon={<MagnifyingGlass size={16} aria-hidden />}
                  value={end ? `${end.name} (${end.crs})` : endQuery}
                  onChange={(value) => {
                    setEndTouched(true)
                    setEnd(null)
                    setEndQuery(value)
                  }}
                  onClear={() => {
                    setEndTouched(false)
                    setEnd(visit[visit.length - 1] || null)
                    setEndQuery('')
                  }}
                  placeholder="Last visit, or search"
                  className="search-input-shell"
                  colorVariant="primary"
                  showClear
                />
                {!end ? <StationSuggestList stations={endSuggestions} onPick={(s) => {
                  const crs = stationCrs(s)
                  if (!crs) return
                  setEndTouched(true)
                  setEnd({ crs, name: s.stationName })
                  setEndQuery('')
                }} /> : null}
              </div>
            </SidebarDropdownSection>

            <SidebarDropdownSection title="Date and time" defaultExpanded>
              <div className="bash-filter-group">
                <p className="bash-filter-label">Date</p>
                <TXTINPBUTWideButton
                  id="bash-date"
                  type="date"
                  value={date}
                  min={minDate}
                  max={maxDate}
                  onChange={setDate}
                  showClear={false}
                  ariaLabel="Date"
                  colorVariant="primary"
                />
              </div>
              <div className="bash-filter-group">
                <p className="bash-filter-label">Time</p>
                <TXTINPBUTWideButton
                  id="bash-time"
                  type="time"
                  value={time}
                  onChange={setTime}
                  showClear={false}
                  ariaLabel="Time"
                  colorVariant="primary"
                />
              </div>
              <BUTWideButton
                width="fill"
                colorVariant="accent"
                instantAction
                disabled={planning}
                onClick={() => void runPlan()}
              >
                {planning ? 'Planning…' : 'Plan itinerary'}
              </BUTWideButton>
              {error ? <p className="bash-error bash-plan-error" role="alert">{error}</p> : null}
            </SidebarDropdownSection>
          </SidebarPanel>
        </aside>

        <main className="browse-main">
          {!result ? (
            <p className="bash-muted">Add GB National Rail stations, set start and end, then plan. You alight at each visit; the official path waits 5 minutes before the next train.</p>
          ) : (
            <>
              <header className="units-service-content-head bash-result-head">
                <div className="bash-result-copy">
                  <h2>
                    {result.start?.name} → {result.end?.name}
                  </h2>
                  <p>
                    {result.date} at {result.at}
                    {typeof result.totalMin === 'number' ? ` · ${result.totalMin} min` : ''}
                    {result.finishAt ? ` · finish ${result.finishAt}` : ''}
                  </p>
                </div>
                <BUTWideButton
                  width="hug"
                  colorVariant="secondary"
                  instantAction
                  onClick={() => exportBashPlanPdf(result)}
                >
                  Export PDF
                </BUTWideButton>
              </header>
              {result.caution ? <p className="bash-caution">{result.caution}</p> : null}
              <div className="bash-timeline">
                {(result.hops || []).map((hop, index) => {
                  const historicalMode = Boolean(result.date && result.date < now.date)
                  const hops = result.hops || []
                  const openService = (leg: BashPlanLeg) => {
                    const qp = new URLSearchParams()
                    if (result.date || date) qp.set('date', result.date || date)
                    if (result.at || time) qp.set('at', result.at || time)
                    qp.set('from', '/bash-planner')
                    router.push(`/services/${encodeURIComponent(leg.rid)}?${qp.toString()}`)
                  }
                  return (
                    <article key={`${hop.fromCrs}-${hop.toCrs}-${index}`} className="bash-hop">
                      <p className="bash-hop-kicker">
                        {hopKicker(hop)}
                      </p>
                      <ol className="bash-leg-list">
                        {hop.legs.map((leg, legIndex) => {
                          const walk = isWalkLeg(leg)
                          const isLastLeg = legIndex === hop.legs.length - 1
                          const destName = isLastLeg ? hop.toName : leg.toName
                          const destCrs = isLastLeg ? hop.toCrs : leg.toCrs
                          const destArr = isLastLeg ? hop.arr : leg.arr
                          const connection = nextConnection(hops, index, hop, legIndex, leg)
                          const instructionTitle = travelAlightTitle({
                            dep: leg.dep,
                            arr: destArr,
                            name: destName,
                            crs: destCrs,
                          })
                          const instructionDescription = connection
                            ? connectionDescription(connection)
                            : null
                          const instructionCard = (
                            <TextCard
                              className="bash-instruction-card"
                              static
                              title={instructionTitle}
                              description={instructionDescription || undefined}
                              trailingIcon={<span />}
                              ariaLabel={instructionDescription
                                ? `${instructionTitle} ${instructionDescription}`
                                : instructionTitle}
                            />
                          )
                          if (walk) {
                            return (
                              <li key={`${leg.rid}-${leg.dep}-${leg.fromCrs}`} className="bash-leg-row bash-leg-row--walk">
                                <TextCard
                                  className="bash-walk-card"
                                  state="accent"
                                  static
                                  title={walkTitle(leg)}
                                  description={walkDescription(leg, destArr, connection)}
                                  trailingIcon={<span />}
                                  ariaLabel={`${walkTitle(leg)}. Leave at ${leg.dep}, arrive at ${destArr}.`}
                                />
                              </li>
                            )
                          }
                          const row = leg.board
                            ? applyBoardFormationOverlay(leg.board, formationOverlays.get(overlayKeyForRow(leg.board)))
                            : null
                          return (
                            <li key={`${leg.rid}-${leg.dep}-${leg.fromCrs}`} className="bash-leg-row">
                              {row ? (
                                <DarwinServiceCard
                                  row={row}
                                  historicalMode={historicalMode}
                                  detailedInfo
                                  showFormation={liveToday}
                                  onClick={() => openService(leg)}
                                  ariaLabel={`${leg.trainId} ${leg.dep} from ${leg.fromName} to ${leg.toName}`}
                                />
                              ) : (
                                <button type="button" className="bash-board-line" onClick={() => openService(leg)}>
                                  Get {leg.trainId || 'train'} at {leg.fromName} · {leg.dep}
                                </button>
                              )}
                              {instructionCard}
                            </li>
                          )
                        })}
                      </ol>
                      {hop.riskyConnections.length > 0 ? (
                        <div className="bash-risky">
                          <h4>Risky trains before 5 minutes</h4>
                          <p>These leave soon after arrival and are not the train you just left. Catching them depends on station layout and delay.</p>
                          <ul className="bash-leg-list">
                            {hop.riskyConnections.map((risky) => (
                              <li key={`${risky.rid}-${risky.dep}`}>
                                <Link href={`/services/${encodeURIComponent(risky.rid)}?date=${encodeURIComponent(result.date || date)}&at=${encodeURIComponent(result.at || time)}`}>
                                  Get {risky.trainId || 'train'} at {risky.dep} (+{risky.minsAfterArrival}m) toward {risky.destName}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

export default BashPlannerPageClient
