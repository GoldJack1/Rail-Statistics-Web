import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type Firestore
} from 'firebase/firestore'

import {
  DPAYG_FARES_COLLECTION,
  DPAYG_SCHEMES_COLLECTION,
  dpaygFareDocId,
  type DPAYGCap,
  type DPAYGFare,
  type DPAYGFareAmounts,
  type DPAYGOperatorOption,
  type DPAYGOperatorSelection,
  type DPAYGPricingModel,
  type DPAYGScheme,
  type DPAYGStation
} from '@/types/dpayg'

import { getTicketsFirestore } from './ticketFirestore'

const BATCH_SIZE = 400

const ensureTicketsDb = async (): Promise<Firestore> => getTicketsFirestore()

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const asNumber = (value: unknown, fallback = 0): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

const asBool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback

const parsePricingModel = (value: unknown): DPAYGPricingModel =>
  value === 'dynamic' ? 'dynamic' : 'fixed_table'

const parseOperatorSelection = (value: unknown): DPAYGOperatorSelection =>
  value === 'fixed' ? 'fixed' : 'single_choice'

const parseStations = (value: unknown): DPAYGStation[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const crs = asString(row.crs).trim().toUpperCase()
      const name = asString(row.name).trim()
      if (!crs && !name) return null
      return { crs, name }
    })
    .filter((s): s is DPAYGStation => s != null)
}

const parseOperators = (value: unknown): DPAYGOperatorOption[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const name = asString((item as Record<string, unknown>).name).trim()
      if (!name) return null
      return { name }
    })
    .filter((o): o is DPAYGOperatorOption => o != null)
}

const parseCaps = (value: unknown): DPAYGCap => {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const dailyLabel = asString(row.dailyLabel).trim()
  const weeklyLabel = asString(row.weeklyLabel).trim()
  return {
    dailyPence: asNumber(row.dailyPence, 0),
    weeklyPence: asNumber(row.weeklyPence, 0),
    ...(dailyLabel ? { dailyLabel } : {}),
    ...(weeklyLabel ? { weeklyLabel } : {})
  }
}

const parseFareAmounts = (value: unknown): DPAYGFareAmounts => {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    peakStandardPence: asNumber(row.peakStandardPence, 0),
    peakRailcardEstPence: asNumber(row.peakRailcardEstPence, 0),
    offPeakStandardPence: asNumber(row.offPeakStandardPence, 0),
    offPeakRailcardEstPence: asNumber(row.offPeakRailcardEstPence, 0)
  }
}

const mapSchemeDoc = (id: string, data: DocumentData): DPAYGScheme => {
  const pricingNote = asString(data.pricingNote).trim()
  return {
    id,
    name: asString(data.name),
    shortName: asString(data.shortName),
    operatorBrand: asString(data.operatorBrand),
    stnarea: asString(data.stnarea),
    status: asString(data.status, 'trial'),
    pricingModel: parsePricingModel(data.pricingModel),
    sortOrder: asNumber(data.sortOrder, 0),
    stations: parseStations(data.stations),
    caps: parseCaps(data.caps),
    operators: parseOperators(data.operators),
    operatorSelection: parseOperatorSelection(data.operatorSelection),
    defaultOperator: asString(data.defaultOperator),
    railcardEstimates: asBool(data.railcardEstimates, false),
    ...(pricingNote ? { pricingNote } : {})
  }
}

const mapFareDoc = (id: string, data: DocumentData): DPAYGFare | null => {
  const schemeId = asString(data.schemeId).trim()
  const originCrs = asString(data.originCrs).trim().toUpperCase()
  const destCrs = asString(data.destCrs).trim().toUpperCase()
  if (!schemeId || !originCrs || !destCrs) return null
  return {
    id: id || dpaygFareDocId(schemeId, originCrs, destCrs),
    schemeId,
    originCrs,
    destCrs,
    originName: asString(data.originName),
    destName: asString(data.destName),
    fares: parseFareAmounts(data.fares)
  }
}

const schemeWritePayload = (scheme: DPAYGScheme): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    name: scheme.name,
    shortName: scheme.shortName,
    operatorBrand: scheme.operatorBrand,
    stnarea: scheme.stnarea,
    status: scheme.status,
    pricingModel: scheme.pricingModel,
    sortOrder: scheme.sortOrder,
    stations: scheme.stations.map((s) => ({
      crs: s.crs.trim().toUpperCase(),
      name: s.name.trim()
    })),
    caps: {
      dailyPence: scheme.caps.dailyPence,
      weeklyPence: scheme.caps.weeklyPence,
      ...(scheme.caps.dailyLabel?.trim()
        ? { dailyLabel: scheme.caps.dailyLabel.trim() }
        : {}),
      ...(scheme.caps.weeklyLabel?.trim()
        ? { weeklyLabel: scheme.caps.weeklyLabel.trim() }
        : {})
    },
    operators: scheme.operators.map((o) => ({ name: o.name.trim() })).filter((o) => o.name),
    operatorSelection: scheme.operatorSelection,
    defaultOperator: scheme.defaultOperator,
    railcardEstimates: scheme.railcardEstimates
  }
  if (scheme.pricingNote?.trim()) {
    payload.pricingNote = scheme.pricingNote.trim()
  }
  return payload
}

const fareWritePayload = (fare: DPAYGFare): Record<string, unknown> => ({
  schemeId: fare.schemeId,
  originCrs: fare.originCrs.toUpperCase(),
  destCrs: fare.destCrs.toUpperCase(),
  originName: fare.originName,
  destName: fare.destName,
  fares: {
    peakStandardPence: fare.fares.peakStandardPence,
    peakRailcardEstPence: fare.fares.peakRailcardEstPence,
    offPeakStandardPence: fare.fares.offPeakStandardPence,
    offPeakRailcardEstPence: fare.fares.offPeakRailcardEstPence
  }
})

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const cloneDpaygScheme = (scheme: DPAYGScheme): DPAYGScheme => cloneJson(scheme)
export const cloneDpaygFares = (fares: DPAYGFare[]): DPAYGFare[] => cloneJson(fares)

export const schemesEqual = (a: DPAYGScheme, b: DPAYGScheme): boolean =>
  JSON.stringify(schemeWritePayload(a)) === JSON.stringify(schemeWritePayload(b))

export const faresEqual = (a: DPAYGFare, b: DPAYGFare): boolean =>
  JSON.stringify(fareWritePayload(a)) === JSON.stringify(fareWritePayload(b))

export type DPAYGSchemeListItem = DPAYGScheme & { fareCount: number }

export type ListSchemesOptions = {
  /**
   * When true, also download every `dpayg_fares` doc to compute per-scheme counts.
   * Admin list needs this; the public fare lookup does not (and it dominates cold load time).
   */
  includeFareCounts?: boolean
}

/** Session cache for the lightweight schemes list (no fare scan). */
let schemesListCache: DPAYGSchemeListItem[] | null = null
let schemesListInflight: Promise<DPAYGSchemeListItem[]> | null = null

export const invalidateSchemesListCache = (): void => {
  schemesListCache = null
  schemesListInflight = null
}

export const listSchemes = async (
  options?: ListSchemesOptions
): Promise<DPAYGSchemeListItem[]> => {
  const includeFareCounts = options?.includeFareCounts === true

  if (!includeFareCounts) {
    if (schemesListCache) return schemesListCache
    if (schemesListInflight) return schemesListInflight
  }

  const load = (async (): Promise<DPAYGSchemeListItem[]> => {
    const db = await ensureTicketsDb()
    const schemesSnap = await getDocs(collection(db, DPAYG_SCHEMES_COLLECTION))

    let fareCounts = new Map<string, number>()
    if (includeFareCounts) {
      const faresSnap = await getDocs(collection(db, DPAYG_FARES_COLLECTION))
      fareCounts = new Map<string, number>()
      for (const fareDoc of faresSnap.docs) {
        const schemeId = asString(fareDoc.data().schemeId).trim()
        if (!schemeId) continue
        fareCounts.set(schemeId, (fareCounts.get(schemeId) ?? 0) + 1)
      }
    }

    return schemesSnap.docs
      .map((snap) => {
        const scheme = mapSchemeDoc(snap.id, snap.data())
        return { ...scheme, fareCount: fareCounts.get(scheme.id) ?? 0 }
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.shortName.localeCompare(b.shortName))
  })()

  if (!includeFareCounts) {
    schemesListInflight = load
    try {
      const rows = await load
      schemesListCache = rows
      return rows
    } finally {
      schemesListInflight = null
    }
  }

  return load
}

export const getScheme = async (schemeId: string): Promise<DPAYGScheme | null> => {
  const db = await ensureTicketsDb()
  const snap = await getDoc(doc(db, DPAYG_SCHEMES_COLLECTION, schemeId))
  if (!snap.exists()) return null
  return mapSchemeDoc(snap.id, snap.data())
}

export const getFareForOd = async (
  schemeId: string,
  originCrs: string,
  destCrs: string
): Promise<DPAYGFare | null> => {
  const db = await ensureTicketsDb()
  const fareId = dpaygFareDocId(schemeId, originCrs, destCrs)
  const snap = await getDoc(doc(db, DPAYG_FARES_COLLECTION, fareId))
  if (!snap.exists()) return null
  return mapFareDoc(snap.id, snap.data())
}

export const listFares = async (schemeId: string): Promise<DPAYGFare[]> => {
  const db = await ensureTicketsDb()
  const q = query(collection(db, DPAYG_FARES_COLLECTION), where('schemeId', '==', schemeId))
  const snap = await getDocs(q)
  const fares = snap.docs
    .map((d) => mapFareDoc(d.id, d.data()))
    .filter((f): f is DPAYGFare => f != null)

  fares.sort((a, b) => {
    const originCmp = a.originCrs.localeCompare(b.originCrs) || a.originName.localeCompare(b.originName)
    if (originCmp !== 0) return originCmp
    return a.destCrs.localeCompare(b.destCrs) || a.destName.localeCompare(b.destName)
  })
  return fares
}

export type PublishSchemeAndFaresInput = {
  scheme: DPAYGScheme
  /** Full draft fare list for the scheme (upserted). */
  fares: DPAYGFare[]
  /** Fare document IDs removed from the draft (deleted on publish). */
  deletedFareIds: string[]
  /** When false, skip writing the scheme doc (fares-only). Default true. */
  schemeChanged?: boolean
  /** Fare IDs that differ from the loaded snapshot (upserted). If omitted, all fares are upserted. */
  changedFareIds?: string[]
}

const commitInChunks = async (
  db: Firestore,
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>
): Promise<void> => {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const chunk = ops.slice(i, i + BATCH_SIZE)
    const batch = writeBatch(db)
    for (const apply of chunk) apply(batch)
    await batch.commit()
  }
}

/**
 * Diff draft vs snapshot and commit scheme + fare upserts/deletes in batches of ~400.
 * On failure the caller keeps the draft; this function does not mutate UI state.
 */
export const publishSchemeAndFares = async (input: PublishSchemeAndFaresInput): Promise<void> => {
  const db = await ensureTicketsDb()
  const schemeId = input.scheme.id
  if (!schemeId.trim()) throw new Error('Scheme id is required.')

  const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = []

  if (input.schemeChanged !== false) {
    const schemeRef = doc(db, DPAYG_SCHEMES_COLLECTION, schemeId)
    const payload = schemeWritePayload(input.scheme)
    ops.push((batch) => batch.set(schemeRef, payload, { merge: true }))
  }

  const changedSet =
    input.changedFareIds != null ? new Set(input.changedFareIds) : null

  for (const fare of input.fares) {
    const origin = fare.originCrs.trim().toUpperCase()
    const dest = fare.destCrs.trim().toUpperCase()
    if (!origin || !dest) continue
    const id = dpaygFareDocId(schemeId, origin, dest)
    if (changedSet && !changedSet.has(id) && !changedSet.has(fare.id)) continue
    const normalized: DPAYGFare = {
      ...fare,
      id,
      schemeId,
      originCrs: origin,
      destCrs: dest
    }
    const fareRef = doc(db, DPAYG_FARES_COLLECTION, id)
    const payload = fareWritePayload(normalized)
    ops.push((batch) => batch.set(fareRef, payload, { merge: true }))
  }

  for (const deletedId of input.deletedFareIds) {
    const id = deletedId.trim()
    if (!id) continue
    const fareRef = doc(db, DPAYG_FARES_COLLECTION, id)
    ops.push((batch) => batch.delete(fareRef))
  }

  if (ops.length === 0) return
  await commitInChunks(db, ops)
  invalidateSchemesListCache()
}

/** Convenience: overwrite a single fare doc (tests / scripts). */
export const upsertFareDoc = async (fare: DPAYGFare): Promise<void> => {
  const db = await ensureTicketsDb()
  const id = dpaygFareDocId(fare.schemeId, fare.originCrs, fare.destCrs)
  await setDoc(doc(db, DPAYG_FARES_COLLECTION, id), fareWritePayload({ ...fare, id }), {
    merge: true
  })
}

export const deleteFareDoc = async (fareId: string): Promise<void> => {
  const db = await ensureTicketsDb()
  await deleteDoc(doc(db, DPAYG_FARES_COLLECTION, fareId))
}
