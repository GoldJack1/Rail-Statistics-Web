import type { ConsistData, ServiceAssociation, ServiceDetail, ServiceStop } from '../types/darwin'

export function joinStationNames(names: Array<string | null | undefined>): string {
  const unique = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))]
  if (unique.length === 0) return ''
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')} & ${unique[unique.length - 1]}`
}

export function serviceDestinationLabel(data: Pick<ServiceDetail, 'destinationName' | 'destination' | 'stops' | 'associations'>): string {
  const extras = (data.associations || [])
    .filter((a) => a.category === 'VV' && a.role === 'main' && !a.isCancelled)
    .map((a) => a.otherDestinationName)
  const published = String(data.destinationName || '').trim()
  if (published.includes(' & ') && extras.length === 0) return published
  const last = [...(data.stops || [])].reverse().find((s) => s.slot !== 'PP')
  const own = last?.name && last.name !== last.tpl
    ? last.name
    : published.split(' & ')[0] || data.destination || ''
  return joinStationNames([own, ...extras]) || published || own
}

export function boardDestinationLabel(row: {
  destinationName?: string | null
  destination?: string | null
  associationDestinations?: Array<string | null | undefined> | null
}): string {
  const published = String(row.destinationName || '').trim()
  const extras = row.associationDestinations || []
  if (published.includes(' & ')) return published
  return joinStationNames([published || row.destination, ...extras]) || published || String(row.destination || '')
}

function stopMinutes(stop: ServiceStop): number | null {
  const raw = stop.ptd || stop.pta || stop.wtd || stop.wta || stop.wtp
  if (!raw) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  return (Number(m[1]) % 24) * 60 + Number(m[2])
}

function orderStops(stops: ServiceStop[]): ServiceStop[] {
  let seenEvening = false
  let overnightLong = false
  for (const stop of stops) {
    const mins = stopMinutes(stop)
    if (mins == null) continue
    if (mins >= 18 * 60) seenEvening = true
    if (seenEvening && mins < 12 * 60) overnightLong = true
  }
  const rail = (mins: number) => (overnightLong && mins < 12 * 60) || (!overnightLong && mins < 2 * 60) ? mins + 1440 : mins
  return stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => {
      const am = stopMinutes(a.stop)
      const bm = stopMinutes(b.stop)
      if (am == null && bm == null) return a.index - b.index
      if (am == null) return 1
      if (bm == null) return -1
      return rail(am) - rail(bm) || a.index - b.index
    })
    .map((row) => row.stop)
}

function passengerIndex(stops: ServiceStop[], tpl: string): number {
  const want = String(tpl || '').toUpperCase()
  const pax = stops.findIndex((s) => s.tpl.toUpperCase() === want && s.slot !== 'PP')
  if (pax >= 0) return pax
  return stops.findIndex((s) => s.tpl.toUpperCase() === want)
}

export function consistThroughSplit(consist: ConsistData | null | undefined, splitTpl: string, side: 'together' | 'onward'): ConsistData | null {
  if (!consist?.allocations?.length) return consist || null
  const allocations = consist.allocations.filter((a) => {
    const orig = a.allocationOrigin?.tiploc || ''
    return side === 'onward' ? orig === splitTpl : orig !== splitTpl
  })
  if (!allocations.length) return { ...consist, allocations: [] }
  return { ...consist, allocations }
}

export type SplitPortion = {
  rid: string
  uid: string
  trainId: string
  originName: string
  destinationName: string
  consist: ConsistData | null
  stops: ServiceStop[]
}

export type SplitWorking = {
  splitTpl: string
  splitName: string
  togetherTrainId: string
  togetherOriginName: string
  togetherStops: ServiceStop[]
  togetherConsist: ConsistData | null
  portions: SplitPortion[]
  associations: ServiceAssociation[]
}

export function splitTogetherLabel(split: SplitWorking): string {
  const from = [split.togetherTrainId, split.togetherOriginName].filter(Boolean).join(' ')
  if (!from) return `to ${split.splitName}`.trim()
  return `${from} to ${split.splitName}`
}

export function splitPortionLabel(portion: SplitPortion, splitName: string): string {
  const origin = portion.originName || splitName
  const from = [portion.trainId, origin].filter(Boolean).join(' ')
  if (!from) return `to ${portion.destinationName}`.trim()
  return `${from} to ${portion.destinationName}`
}

export function buildSplitWorking(self: ServiceDetail, partners: ServiceDetail[]): SplitWorking | null {
  const links = (self.associations || []).filter(
    (a) => (a.category === 'VV' || a.category === 'JJ') && !a.isDeleted,
  )
  if (!links.length) return null
  const splitTpl = links[0].tiploc
  if (!splitTpl) return null
  const atSplit = links.filter((a) => a.tiploc === splitTpl)
  const isJoin = atSplit.every((a) => a.category === 'JJ') || atSplit.some((a) => a.category === 'JJ')

  const byKey = new Map<string, ServiceDetail>()
  const remember = (svc: ServiceDetail | undefined) => {
    if (!svc?.rid) return
    byKey.set(svc.rid, svc)
    if (svc.uid) byKey.set(svc.uid.toUpperCase(), svc)
  }
  remember(self)
  for (const p of partners) remember(p)

  const main =
    atSplit[0].role === 'associated'
      ? byKey.get(atSplit[0].otherRid) || byKey.get(String(atSplit[0].otherUid || '').toUpperCase())
      : self
  if (!main) return null

  const orderedMain = orderStops(main.stops)
  const splitAt = passengerIndex(orderedMain, splitTpl)
  const togetherStops = splitAt >= 0
    ? (isJoin ? orderedMain.slice(splitAt) : orderedMain.slice(0, splitAt + 1))
    : orderedMain
  const splitName = isJoin
    ? ([...togetherStops].reverse().find((s) => s.slot !== 'PP')?.name || main.destinationName || splitTpl)
    : (togetherStops[togetherStops.length - 1]?.name || splitTpl)

  const portions: SplitPortion[] = []
  const seen = new Set<string>()
  const addPortion = (svc: ServiceDetail) => {
    if (seen.has(svc.rid)) return
    seen.add(svc.rid)
    const ordered = orderStops(svc.stops)
    const i = passengerIndex(ordered, splitTpl)
    let branch: ServiceStop[] = []
    if (isJoin) {
      branch = i >= 0 ? ordered.slice(0, i + 1) : svc.rid === main.rid ? [] : ordered
    } else {
      const start = i >= 0 ? i : svc.rid === main.rid ? -1 : 0
      branch = start >= 0 ? ordered.slice(start) : []
    }
    if (!branch.length) return
    const dest = [...branch].reverse().find((s) => s.slot !== 'PP')?.name || svc.destinationName || svc.destination
    const origin = branch.find((s) => s.slot !== 'PP')?.name || splitName
    portions.push({
      rid: svc.rid,
      uid: svc.uid,
      trainId: svc.trainId,
      originName: origin || '',
      destinationName: dest || '',
      consist: consistThroughSplit(svc.consist, splitTpl, isJoin ? 'together' : 'onward'),
      stops: branch,
    })
  }
  addPortion(main)
  const allowed = new Set(
    atSplit.flatMap((a) => [a.otherRid, a.otherUid, a.assocRid, a.mainRid].filter(Boolean).map((id) => String(id).toUpperCase())),
  )
  for (const p of partners) {
    if (allowed.has(p.rid.toUpperCase()) || allowed.has((p.uid || '').toUpperCase())) addPortion(p)
  }
  addPortion(self)

  if (!portions.length) return null
  const togetherOriginName =
    togetherStops.find((s) => s.slot !== 'PP')?.name || (isJoin ? splitTpl : main.originName) || main.origin || ''
  return {
    splitTpl,
    splitName,
    togetherTrainId: main.trainId || '',
    togetherOriginName,
    togetherStops,
    togetherConsist: consistThroughSplit(main.consist, splitTpl, isJoin ? 'onward' : 'together'),
    portions,
    associations: atSplit,
  }
}
