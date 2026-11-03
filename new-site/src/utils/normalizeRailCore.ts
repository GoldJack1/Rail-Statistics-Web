import type { DepartureRow, DeparturesSnapshot, ServiceDetail, ServiceStop } from '@/types/darwin'
import { publicStationName, publicStationNameOrNull } from '@/utils/publicStationName'

type RailCoreCall = {
  crs?: string | null
  tiploc?: string
  seq?: number
  isPassing?: boolean
  platform?: string | null
  sta?: string | null
  std?: string | null
  wta?: string | null
  wtd?: string | null
  wtp?: string | null
  ata?: string | null
  atd?: string | null
  atp?: string | null
  eta?: string | null
  etd?: string | null
  etp?: string | null
  liveKind?: string | null
  actualSource?: string | null
  loadingPercentage?: number | null
  coachLoading?: ServiceStop['coachLoading']
  legMiles?: number | null
  cumMiles?: number | null
  cumM?: number | null
  lat?: number | null
  lng?: number | null
  path?: string | null
  line?: string | null
}

function liveFromCall(c: RailCoreCall): { liveTime: string | null; liveKind: ServiceStop['liveKind'] } {
  const actual = c.atd || c.ata || c.atp
  const est = c.etd || c.eta || c.etp
  if (actual) {
    return { liveTime: actual, liveKind: c.atp && !c.atd && !c.ata ? 'actual' : c.ata && !c.atd ? 'actual-arr' : 'actual' }
  }
  if (est) return { liveTime: est, liveKind: 'est' }
  if (c.liveKind === 'working') return { liveTime: c.wtd || c.wta || c.wtp || null, liveKind: 'working' }
  return { liveTime: null, liveKind: 'scheduled' }
}

/** Turn a stored `TRUST:0002:I8` reason into text plus the cancellation code. */
export function presentCancellation<T extends { source: string; reason: string; code?: string } | null | undefined>(
  reason: T,
): T {
  if (!reason?.reason) return reason
  const raw = reason.reason.trim()
  const match = /^TRUST:0002(?::([^@\s]+))?(?:@\S+)?$/.exec(raw)
  if (!match) return reason
  const code = reason.code || match[1] || undefined
  return {
    ...reason,
    reason: raw.includes('@') ? 'Cancelled en route' : 'Cancelled',
    ...(code ? { code } : {}),
  }
}

function stopWasRecorded(stop: Pick<ServiceStop, 'ata' | 'atd' | 'atp'>): boolean {
  return [stop.ata, stop.atd, stop.atp].some((value) => String(value || '').trim().length > 0)
}

/**
 * A TRUST/Darwin service cancellation covers every call still to be served.
 * Stops that already have an actual stay as they ran. The query API now sets
 * this itself; this also covers payloads that only set `cancelled`.
 */
export function applyWholeServiceCancellation(detail: ServiceDetail): ServiceDetail {
  if (!detail) return detail
  const cancellation = presentCancellation(detail.cancellation)
  const withReason = cancellation === detail.cancellation ? detail : { ...detail, cancellation }
  if (!withReason.cancelled || !withReason.stops?.length) return withReason
  return {
    ...withReason,
    stops: withReason.stops.map((stop) => {
      const cancelReasonAtStop = presentCancellation(stop.cancelReasonAtStop || withReason.cancellation)
      if (stop.cancelledAtStop || stopWasRecorded(stop)) {
        return cancelReasonAtStop === stop.cancelReasonAtStop ? stop : { ...stop, cancelReasonAtStop }
      }
      return {
        ...stop,
        cancelledAtStop: true,
        cancelReasonAtStop,
      }
    }),
  }
}

function hydrateStopLive(stop: ServiceStop): ServiceStop {
  const derived = liveFromCall({
    ata: stop.ata,
    atd: stop.atd,
    atp: stop.atp,
    eta: stop.eta,
    etd: stop.etd,
    etp: stop.etp,
    liveKind: stop.liveKind,
    wta: stop.wta,
    wtd: stop.wtd,
    wtp: stop.wtp,
  })
  const incomingKind = stop.liveKind
  const keepIncoming =
    incomingKind === 'actual' ||
    incomingKind === 'actual-arr' ||
    incomingKind === 'est' ||
    incomingKind === 'est-arr'
  const liveKind =
    derived.liveKind && derived.liveKind !== 'scheduled'
      ? derived.liveKind
      : keepIncoming
        ? incomingKind
        : derived.liveKind || incomingKind || 'scheduled'
  const liveTime =
    derived.liveTime ||
    (liveKind && liveKind !== 'scheduled' && liveKind !== 'working' ? stop.liveTime : null) ||
    (derived.liveKind === 'working' ? derived.liveTime : null)
  return {
    ...stop,
    name: stop.name ? publicStationName(stop.name) || stop.name : stop.name,
    liveTime,
    liveKind,
    etd: stop.etd || (liveKind === 'est' ? liveTime : stop.etd) || null,
    eta: stop.eta || (liveKind === 'est-arr' ? liveTime : stop.eta) || null,
  }
}

export function parseHistoryDatesList(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const dates = (body as { dates?: unknown }).dates
  if (!Array.isArray(dates)) return []
  return dates
    .map((d) => {
      if (typeof d === 'string') return d
      if (d && typeof d === 'object' && 'date' in d) return String((d as { date: string }).date)
      return ''
    })
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort((a, b) => b.localeCompare(a))
}

export function isRailCoreBoard(body: unknown): body is { services: Record<string, unknown>[]; generatedAt?: string; station?: { crs?: string }; crs?: string } {
  if (!body || typeof body !== 'object') return false
  const o = body as { services?: unknown; departures?: unknown }
  return Array.isArray(o.services) && !Array.isArray(o.departures)
}

function rowFromRailCore(r: Record<string, unknown>): DepartureRow {
  const scheduled = String(r.scheduledTime || r.scheduled || '')
  const live = String(r.liveTime || r.actual || r.estimated || scheduled)
  const kind = (r.liveKind as DepartureRow['liveKind']) || (r.actual ? 'actual' : r.estimated ? 'est' : 'scheduled')
  const cancelled = Boolean(r.cancelled)
  const delayMinutes = typeof r.delayMinutes === 'number' ? r.delayMinutes : null
  return {
    rid: String(r.rid || ''),
    trainId: String(r.trainId || r.headcode || r.uid || ''),
    uid: String(r.uid || ''),
    toc: String(r.toc || ''),
    tocName: r.tocName ? String(r.tocName) : r.operatorName ? String(r.operatorName) : null,
    trainCat: r.trainCat ? String(r.trainCat) : r.category ? String(r.category) : null,
    serviceType: (r.serviceType as DepartureRow['serviceType']) || 'passenger',
    isPassing: Boolean(r.isPassing),
    scheduledTime: scheduled,
    scheduledAt: String(r.scheduledAt || `${new Date().toISOString().slice(0, 10)}T${scheduled || '00:00'}:00`),
    liveTime: live,
    liveKind: kind,
    delayMinutes,
    platform: r.platform ? String(r.platform) : null,
    livePlatform: r.livePlatform ? String(r.livePlatform) : r.platform ? String(r.platform) : null,
    origin: String(r.origin || r.originCrs || ''),
    originName: publicStationNameOrNull(r.originName),
    originCrs: r.originCrs ? String(r.originCrs) : null,
    destination: String(r.destination || r.destinationCrs || ''),
    destinationName: publicStationNameOrNull(r.destinationName),
    destinationCrs: r.destinationCrs ? String(r.destinationCrs) : null,
    associationDestinations: Array.isArray(r.associationDestinations)
      ? (r.associationDestinations as unknown[]).map((n) => publicStationName(n)).filter(Boolean)
      : [],
    joinedDestination: publicStationNameOrNull(r.joinedDestination),
    joinedVia: r.joinedVia ? String(r.joinedVia) : null,
    via: typeof r.via === 'string' ? publicStationName(r.via) || null : null,
    callingAfter: Array.isArray(r.callingAfter) ? (r.callingAfter as string[]) : [],
    callingAfterNames: Array.isArray(r.callingAfterNames)
      ? (r.callingAfterNames as (string | null)[]).map((n) => (n ? publicStationName(n) || null : null))
      : [],
    callingAfterCrs: Array.isArray(r.callingAfterCrs) ? (r.callingAfterCrs as (string | null)[]) : [],
    isPassenger: r.isPassenger !== false && String(r.serviceType || 'passenger') !== 'freight',
    cancelled,
    cancellation: (r.cancellation as DepartureRow['cancellation']) || (r.cancelReason ? { source: 'ts', reason: String(r.cancelReason) } : null),
    delayReason: (r.delayReason as DepartureRow['delayReason']) || null,
    loadingPercentage: typeof r.loadingPercentage === 'number' ? r.loadingPercentage : null,
    coachLoading: Array.isArray(r.coachLoading) ? (r.coachLoading as DepartureRow['coachLoading']) : null,
    reverseFormation: false,
    hasConsist: Boolean(r.hasConsist),
    unitIds: Array.isArray(r.unitIds) ? (r.unitIds as string[]) : null,
    actualSource: r.actualSource ? String(r.actualSource) : null,
    locationLabel: r.locationLabel ? String(r.locationLabel) : null,
    hasAssociations: Boolean(r.hasAssociations),
    hasAlerts: false,
    status: String(r.status || (cancelled ? 'Cancelled' : delayMinutes ? `Delayed ${delayMinutes} min` : 'On time')),
  }
}

function tidyDepartureNames<T extends Partial<DepartureRow>>(row: T): T {
  return {
    ...row,
    originName: publicStationNameOrNull(row.originName),
    destinationName: publicStationNameOrNull(row.destinationName),
    via: typeof row.via === 'string' ? publicStationName(row.via) || null : (row.via ?? null),
    joinedDestination: publicStationNameOrNull(row.joinedDestination),
    associationDestinations: Array.isArray(row.associationDestinations)
      ? row.associationDestinations.map((n) => publicStationName(n)).filter(Boolean)
      : row.associationDestinations,
    callingAfterNames: Array.isArray(row.callingAfterNames)
      ? row.callingAfterNames.map((n) => (n ? publicStationName(n) || null : n))
      : row.callingAfterNames,
  }
}

export function normalizeDeparturesSnapshot(body: unknown, fallbackCode: string): DeparturesSnapshot {
  if (body && typeof body === 'object' && Array.isArray((body as DeparturesSnapshot).departures)) {
    const snap = body as DeparturesSnapshot
    return {
      ...snap,
      stationName: publicStationName(snap.stationName) || snap.stationCrs || fallbackCode,
      arrivals: Array.isArray(snap.arrivals) ? snap.arrivals.map(tidyDepartureNames) : [],
      departures: snap.departures.map(tidyDepartureNames),
    }
  }
  const o = (body && typeof body === 'object' ? body : {}) as {
    services?: Record<string, unknown>[]
    generatedAt?: string
    updatedAt?: string
    station?: { crs?: string }
    crs?: string
    stationCrs?: string
    name?: string
    stationName?: string
    tiploc?: string
    matchedAs?: string
  }
  const generatedAt = String(o.generatedAt || o.updatedAt || new Date().toISOString())
  const crs = String(o.crs || o.stationCrs || o.station?.crs || fallbackCode).toUpperCase()
  const rows = Array.isArray(o.services) ? o.services.map(rowFromRailCore) : []
  return {
    tiploc: String(o.tiploc || crs),
    stationName: publicStationName(o.stationName || o.name) || crs,
    stationCrs: crs,
    matchedAs: o.matchedAs === 'tiploc' ? 'tiploc' : 'crs',
    updatedAt: generatedAt,
    timetableFile: '',
    windowHours: 24,
    counts: {
      departures: rows.length,
      arrivals: 0,
      cancelled: rows.filter((r) => r.cancelled).length,
      withDelay: rows.filter((r) => r.delayMinutes).length,
      messages: 0,
    },
    messages: [],
    kafka: {
      consumed: 0,
      updatesApplied: 0,
      startedAt: generatedAt,
      lastMessageAt: generatedAt,
    },
    departures: rows,
    arrivals: [],
  }
}

export function isRailCoreService(body: unknown): body is { callingPoints: RailCoreCall[]; rid: string } {
  return Boolean(
    body &&
      typeof body === 'object' &&
      Array.isArray((body as { callingPoints?: unknown }).callingPoints) &&
      !Array.isArray((body as { stops?: unknown }).stops),
  )
}

export function normalizeServiceDetail(body: unknown): ServiceDetail {
  if (isRailCoreService(body)) {
    const b = body as Record<string, unknown> & { callingPoints: RailCoreCall[] }
    const stops: ServiceStop[] = b.callingPoints.map((c, i) => {
      const live = liveFromCall(c)
      const last = i === b.callingPoints.length - 1
      const first = i === 0
      const slot = c.isPassing ? 'PP' : first ? 'OR' : last ? 'DT' : 'IP'
      return {
        tpl: c.tiploc || '',
        name: null,
        crs: c.crs ?? null,
        slot,
        pta: c.sta ?? null,
        ptd: c.std ?? null,
        wta: c.wta ?? null,
        wtd: c.wtd ?? null,
        wtp: c.wtp ?? null,
        ata: c.ata ?? null,
        atd: c.atd ?? null,
        atp: c.atp ?? null,
        eta: c.eta ?? null,
        etd: c.etd ?? null,
        etp: c.etp ?? null,
        platform: c.platform ?? null,
        livePlatform: c.platform ?? null,
        activity: null,
        liveTime: live.liveTime,
        liveKind: live.liveKind,
        cancelledAtStop: false,
        cancelReasonAtStop: null,
        loadingPercentage: typeof c.loadingPercentage === 'number' ? c.loadingPercentage : null,
        coachLoading: Array.isArray(c.coachLoading) ? c.coachLoading : null,
        actualSource: c.actualSource ?? null,
        legMiles: typeof c.legMiles === 'number' ? c.legMiles : null,
        cumMiles: typeof c.cumMiles === 'number' ? c.cumMiles : null,
        cumM: typeof c.cumM === 'number' ? c.cumM : null,
        lat: typeof c.lat === 'number' ? c.lat : null,
        lng: typeof c.lng === 'number' ? c.lng : null,
        path: c.path ?? null,
        line: c.line ?? null,
      }
    })
    return applyWholeServiceCancellation({
      rid: String(b.rid),
      uid: String(b.uid || ''),
      trainId: String(b.headcode || ''),
      ssd: '',
      toc: String(b.toc || ''),
      tocName: b.tocName ? String(b.tocName) : b.operatorName ? String(b.operatorName) : null,
      trainCat: b.trainCat ? String(b.trainCat) : null,
      trainClass: b.trainClass ? String(b.trainClass) : null,
      powerType: b.powerType ? String(b.powerType) : null,
      timingLoad: b.timingLoad ? String(b.timingLoad) : null,
      diagramNo: b.diagramNo ? String(b.diagramNo) : null,
      diagramDate: b.diagramDate ? String(b.diagramDate) : null,
      isPassenger: String(b.serviceType || 'passenger') === 'passenger',
      origin: String(b.originCrs || ''),
      originName: publicStationNameOrNull(b.originName),
      destination: String(b.destinationCrs || ''),
      destinationName: publicStationNameOrNull(b.destinationName),
      cancelled: Boolean(b.cancelled),
      cancellation: null,
      partiallyCancelled: false,
      delayReason: null,
      reverseFormation: false,
      formation: (b.formation as ServiceDetail['formation']) || null,
      consist: (b.consist as ServiceDetail['consist']) || null,
      associations: Array.isArray(b.associations) ? (b.associations as ServiceDetail['associations']) : [],
      alerts: [],
      stops,
      historicalDate: (b.historicalDate as string) || null,
      location: (b.location as ServiceDetail['location']) || null,
      hspPending: Boolean(b.hspPending),
      updatedAt: new Date().toISOString(),
    })
  }
  const detail = body as ServiceDetail
  if (!detail?.stops?.length) return applyWholeServiceCancellation(detail)
  return applyWholeServiceCancellation({
    ...detail,
    originName: publicStationNameOrNull(detail.originName),
    destinationName: publicStationNameOrNull(detail.destinationName),
    cancellation: presentCancellation(detail.cancellation),
    stops: detail.stops.map((stop) => ({
      ...hydrateStopLive(stop),
      cancelReasonAtStop: presentCancellation(stop.cancelReasonAtStop),
    })),
  })
}
