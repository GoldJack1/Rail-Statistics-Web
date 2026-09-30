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

export function isRailCoreBoard(body: unknown): body is { services: Record<string, unknown>[]; generatedAt?: string; station?: { crs?: string } } {
  if (!body || typeof body !== 'object') return false
  const services = (body as { services?: unknown }).services
  if (!Array.isArray(services) || services.length === 0) return false
  const first = services[0] as Record<string, unknown>
  return 'scheduled' in first && !('scheduledTime' in first)
}

export function normalizeDeparturesSnapshot(body: unknown, fallbackCode: string): DeparturesSnapshot {
  if (!isRailCoreBoard(body)) return body as DeparturesSnapshot
  const generatedAt = String(body.generatedAt || new Date().toISOString())
  const crs = String(body.station?.crs || fallbackCode).toUpperCase()
  const services: DepartureRow[] = body.services.map((raw) => {
    const r = raw as Record<string, unknown>
    const scheduled = String(r.scheduled || '')
    const live = String(r.actual || r.estimated || scheduled)
    const kind = String(r.liveKind || (r.actual ? 'actual' : r.estimated ? 'est' : 'scheduled'))
    return {
      rid: String(r.rid || ''),
      trainId: String(r.headcode || r.uid || ''),
      uid: String(r.uid || ''),
      toc: String(r.toc || ''),
      tocName: r.operatorName ? String(r.operatorName) : null,
      trainCat: r.category ? String(r.category) : null,
      serviceType: (r.serviceType as DepartureRow['serviceType']) || 'passenger',
      isPassing: Boolean(r.isPassing),
      scheduledTime: scheduled,
      scheduledAt: `${generatedAt.slice(0, 10)}T${scheduled || '00:00'}:00`,
      liveTime: live,
      liveKind: kind as DepartureRow['liveKind'],
      delayMinutes: typeof r.delayMinutes === 'number' ? r.delayMinutes : null,
      platform: r.platform ? String(r.platform) : null,
      livePlatform: r.platform ? String(r.platform) : null,
      origin: String(r.originCrs || ''),
      originName: r.originName ? String(r.originName) : null,
      originCrs: r.originCrs ? String(r.originCrs) : null,
      destination: String(r.destinationCrs || ''),
      destinationName: r.destinationName ? String(r.destinationName) : null,
      destinationCrs: r.destinationCrs ? String(r.destinationCrs) : null,
      callingAfter: [],
      callingAfterNames: [],
      callingAfterCrs: [],
      isPassenger: String(r.serviceType || 'passenger') === 'passenger',
      cancelled: Boolean(r.cancelled),
      cancellation: r.cancelReason ? { source: 'ts', reason: String(r.cancelReason) } : null,
      delayReason: r.delayReason ? { source: 'ts', reason: String(r.delayReason) } : null,
      loadingPercentage: null,
      coachLoading: null,
      reverseFormation: false,
      hasConsist: false,
      actualSource: r.actualSource ? String(r.actualSource) : null,
    } as DepartureRow
  })
  return {
    code: crs,
    tiploc: crs,
    crs,
    name: crs,
    generatedAt,
    updatedAt: generatedAt,
    services,
  } as DeparturesSnapshot
}

export function isRailCoreService(body: unknown): body is { callingPoints: RailCoreCall[]; rid: string } {
  return Boolean(body && typeof body === 'object' && Array.isArray((body as { callingPoints?: unknown }).callingPoints))
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
      loadingPercentage: null,
      coachLoading: null,
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
    originName: null,
    destination: String(b.destinationCrs || ''),
    destinationName: null,
    cancelled: Boolean(b.cancelled),
    cancellation: null,
    partiallyCancelled: false,
    delayReason: null,
    reverseFormation: false,
    formation: null,
    consist: null,
    associations: [],
    alerts: [],
    stops,
    updatedAt: new Date().toISOString(),
  }
}
