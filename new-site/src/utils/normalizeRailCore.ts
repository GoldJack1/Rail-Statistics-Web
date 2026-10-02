import type { DepartureRow, DeparturesSnapshot, ServiceDetail, ServiceStop } from '@/types/darwin'

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
    originName: r.originName ? String(r.originName) : null,
    originCrs: r.originCrs ? String(r.originCrs) : null,
    destination: String(r.destination || r.destinationCrs || ''),
    destinationName: r.destinationName ? String(r.destinationName) : null,
    destinationCrs: r.destinationCrs ? String(r.destinationCrs) : null,
    associationDestinations: Array.isArray(r.associationDestinations)
      ? (r.associationDestinations as unknown[]).map((n) => String(n)).filter(Boolean)
      : [],
    via: typeof r.via === 'string' ? r.via : null,
    callingAfter: Array.isArray(r.callingAfter) ? (r.callingAfter as string[]) : [],
    callingAfterNames: Array.isArray(r.callingAfterNames) ? (r.callingAfterNames as (string | null)[]) : [],
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

export function normalizeDeparturesSnapshot(body: unknown, fallbackCode: string): DeparturesSnapshot {
  if (body && typeof body === 'object' && Array.isArray((body as DeparturesSnapshot).departures)) {
    const snap = body as DeparturesSnapshot
    if (!Array.isArray(snap.arrivals)) snap.arrivals = []
    return snap
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
    stationName: o.stationName || o.name || crs,
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
  if (!isRailCoreService(body)) return body as ServiceDetail
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
    }
  })
  return {
    rid: String(b.rid),
    uid: String(b.uid || ''),
    trainId: String(b.headcode || ''),
    ssd: '',
    toc: String(b.toc || ''),
    tocName: b.operatorName ? String(b.operatorName) : null,
    trainCat: null,
    isPassenger: String(b.serviceType || 'passenger') === 'passenger',
    origin: String(b.originCrs || ''),
    originName: b.originName ? String(b.originName) : null,
    destination: String(b.destinationCrs || ''),
    destinationName: b.destinationName ? String(b.destinationName) : null,
    cancelled: Boolean(b.cancelled),
    cancellation: null,
    partiallyCancelled: false,
    delayReason: null,
    reverseFormation: false,
    formation: (b.formation as ServiceDetail['formation']) || null,
    consist: (b.consist as ServiceDetail['consist']) || null,
    associations: [],
    alerts: [],
    stops,
    historicalDate: (b.historicalDate as string) || null,
    location: (b.location as ServiceDetail['location']) || null,
    hspPending: Boolean(b.hspPending),
    updatedAt: new Date().toISOString(),
  }
}
