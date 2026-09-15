import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import readline from 'node:readline'

import { dpaygFareDocId } from '@/types/dpayg'
import type { DPAYGStation } from '@/types/dpayg'
import { findPaygAreaDef, isAllowedPaygCollectionId, type PaygMatrixAreaDef } from '@/types/paygMatrix'
import { fetchTicketCatalogManifest, ticketCatalogCollectionPath } from '@/services/ticketCatalogCdn'
import { buildStationCdnBundleUrl } from '@/services/stationsCdnService'
import { addMissingLondonSeStations } from '@/services/londonSeContactlessExtras'
import { parseMatrixDestination, parseZoneCapBands, parseMatrixMetaStations, parseTfLMetaCapBands } from '@/services/paygMatrixParse'
import type { PaygMatrixFare, PaygZoneCapBand } from '@/services/paygMatrixCatalog'

type CompactFare = {
  destName: string
  destZone?: string
  peak: number
  offPeak: number
  daily: number
  weekly: number
  hasOffPeak: boolean
}

type LoadedCollection = {
  stations: DPAYGStation[]
  fares: Map<string, Map<string, CompactFare>>
  zoneCapBands: PaygZoneCapBand[]
}

const collectionCache = new Map<string, Promise<LoadedCollection>>()
const zoneCapCache = new Map<string, Promise<PaygZoneCapBand[]>>()


const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

async function streamNdjsonGz(path: string, onLine: (obj: Record<string, unknown>) => void) {
  const response = await fetch(buildStationCdnBundleUrl(path))
  if (!response.ok || !response.body) {
    throw new Error(`Ticket catalogue ${path} failed (${response.status})`)
  }

  const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  const lines = readline.createInterface({
    input: nodeStream.pipe(createGunzip()),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    onLine(parsed as Record<string, unknown>)
  }
}

async function loadCollection(collectionId: string): Promise<LoadedCollection> {
  if (!isAllowedPaygCollectionId(collectionId)) {
    throw new Error('Unknown PAYG collection')
  }
  const hit = collectionCache.get(collectionId)
  if (hit) return hit

  const pending = (async () => {
    const manifest = await fetchTicketCatalogManifest()
    const path = ticketCatalogCollectionPath(manifest.version, collectionId)
    const stationMap = new Map<string, DPAYGStation>()
    const fares = new Map<string, Map<string, CompactFare>>()

    const upsertStation = (crs: string, name: string, zone?: string, displayCrs?: string) => {
      const code = crs.trim().toUpperCase()
      const label = name.trim()
      if (!code || !label) return
      const existing = stationMap.get(code)
      const nextZone = zone?.trim() || undefined
      const nextDisplay = displayCrs?.trim().toUpperCase() || undefined
      if (!existing) {
        stationMap.set(code, {
          crs: code,
          name: label,
          ...(nextZone ? { zone: nextZone } : {}),
          ...(nextDisplay ? { displayCrs: nextDisplay } : {}),
        })
        return
      }
      stationMap.set(code, {
        ...existing,
        name: existing.name || label,
        zone: existing.zone || nextZone,
        displayCrs: existing.displayCrs || nextDisplay,
      })
    }

    let metaCaps: PaygZoneCapBand[] = []

    await streamNdjsonGz(path, (obj) => {
      const id = asString(obj.id)
      if (id === '_meta') {
        for (const station of parseMatrixMetaStations(obj.stations)) {
          upsertStation(station.crs, station.name, station.zone, station.displayCrs)
        }
        metaCaps = parseTfLMetaCapBands(obj.caps)
        return
      }
      const originCrs = asString(obj.originCrs || obj.originId || id).trim().toUpperCase()
      const originName = asString(obj.originName).trim() || originCrs
      const originZone = asString(obj.originZone).trim()
      if (!originCrs) return
      upsertStation(originCrs, originName, originZone)

      const destinations = obj.destinations
      if (!destinations || typeof destinations !== 'object') return
      const destMap = fares.get(originCrs) ?? new Map<string, CompactFare>()
      for (const [destKey, raw] of Object.entries(destinations as Record<string, unknown>)) {
        const destId = destKey.trim().toUpperCase()
        const destName = asString(
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>).destName : ''
        ).trim()
        const destZone = asString(
          raw && typeof raw === 'object' ? (raw as Record<string, unknown>).destZone : ''
        ).trim()
        if (destId && destName) upsertStation(destId, destName, destZone)
        const parsed = parseMatrixDestination(destKey, raw)
        if (!parsed) continue
        upsertStation(parsed.destCrs, parsed.destName, parsed.destZone)
        destMap.set(parsed.destCrs, {
          destName: parsed.destName,
          ...(parsed.destZone ? { destZone: parsed.destZone } : {}),
          peak: parsed.fares.peakStandardPence,
          offPeak: parsed.fares.offPeakStandardPence,
          daily: parsed.dailyCapPence,
          weekly: parsed.weeklyCapPence,
          hasOffPeak: parsed.hasOffPeak,
        })
      }
      fares.set(originCrs, destMap)
    })

    const loadedStations = [...stationMap.values()]
    const stations = (
      collectionId === 'contactless_LDN+SE'
        ? addMissingLondonSeStations(loadedStations)
        : loadedStations
    ).sort((a, b) => a.name.localeCompare(b.name) || a.crs.localeCompare(b.crs))
    return { stations, fares, zoneCapBands: metaCaps }
  })()

  collectionCache.set(collectionId, pending)
  return pending
}

async function loadZoneCaps(collectionId?: string): Promise<PaygZoneCapBand[]> {
  if (!collectionId) return []
  const hit = zoneCapCache.get(collectionId)
  if (hit) return hit
  const pending = (async () => {
    const manifest = await fetchTicketCatalogManifest()
    const path = ticketCatalogCollectionPath(manifest.version, collectionId)
    const bands: PaygZoneCapBand[] = []
    await streamNdjsonGz(path, (obj) => {
      bands.push(...parseZoneCapBands(obj.caps))
    })
    return bands
  })()
  zoneCapCache.set(collectionId, pending)
  return pending
}

function defToAreaPayload(
  def: PaygMatrixAreaDef,
  stations: DPAYGStation[],
  zoneCapBands: PaygZoneCapBand[]
) {
  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    operatorBrand: def.operatorBrand,
    stnarea: 'GBNR',
    status: 'live',
    pricingModel: 'fixed_table' as const,
    sortOrder: 0,
    stations,
    caps: { dailyPence: 0, weeklyPence: 0 },
    operators: [{ name: def.operatorBrand }],
    operatorSelection: 'fixed' as const,
    defaultOperator: def.operatorBrand,
    railcardEstimates: false,
    zoneCapBands,
    hideStationCodes: def.hideStationCodes === true,
    oysterFareTypes: def.oysterFareTypes,
    collectionId: def.collectionId,
  }
}

export async function getPaygAreaPayload(areaId: string, collectionId?: string) {
  const def = findPaygAreaDef(areaId)
  if (!def) throw new Error('Unknown PAYG area')
  const resolvedCollection =
    collectionId && isAllowedPaygCollectionId(collectionId) ? collectionId : def.collectionId
  const [loaded, fileCaps] = await Promise.all([
    loadCollection(resolvedCollection),
    loadZoneCaps(def.zoneCapsCollectionId),
  ])
  const zoneCapBands = fileCaps.length > 0 ? fileCaps : loaded.zoneCapBands
  return defToAreaPayload(def, loaded.stations, zoneCapBands)
}

export async function getPaygFarePayload(
  areaId: string,
  originCrs: string,
  destCrs: string,
  collectionId?: string
): Promise<PaygMatrixFare | null> {
  const def = findPaygAreaDef(areaId)
  if (!def) throw new Error('Unknown PAYG area')
  const resolvedCollection =
    collectionId && isAllowedPaygCollectionId(collectionId) ? collectionId : def.collectionId
  const loaded = await loadCollection(resolvedCollection)
  const origin = originCrs.trim().toUpperCase()
  const dest = destCrs.trim().toUpperCase()
  const compact = loaded.fares.get(origin)?.get(dest)
  if (!compact) return null
  const originName = loaded.stations.find((s) => s.crs === origin)?.name ?? origin
  const originZone = loaded.stations.find((s) => s.crs === origin)?.zone
  return {
    id: dpaygFareDocId(def.id, origin, dest),
    schemeId: def.id,
    originCrs: origin,
    originName,
    destCrs: dest,
    destName: compact.destName,
    fares: {
      peakStandardPence: compact.peak,
      peakRailcardEstPence: 0,
      offPeakStandardPence: compact.offPeak,
      offPeakRailcardEstPence: 0,
    },
    dailyCapPence: compact.daily,
    weeklyCapPence: compact.weekly,
    hasOffPeak: compact.hasOffPeak,
    ...(originZone ? { originZone } : {}),
    ...(compact.destZone ? { destZone: compact.destZone } : {}),
  }
}
