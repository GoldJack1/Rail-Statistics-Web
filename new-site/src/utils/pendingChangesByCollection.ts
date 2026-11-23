import type { PendingChangeEntry } from '../contexts/pendingStationChangesTypes'
import type { StationCollectionId } from '../constants/stationCollections'
import { DEFAULT_NETWORK_COLLECTION_ID, isStationCollectionId } from '../constants/stationCollections'
import { getStationNetworkCollectionId } from './stationAreaSlug'

/** Resolve which Firestore collection a pending entry should write to. */
export function resolvePendingTargetCollectionId(
  entry: Partial<PendingChangeEntry> | undefined,
  fallback: StationCollectionId = DEFAULT_NETWORK_COLLECTION_ID
): StationCollectionId {
  if (!entry) return fallback

  const stored =
    entry.targetCollectionId && isStationCollectionId(entry.targetCollectionId)
      ? entry.targetCollectionId
      : null

  // New stations are explicitly created in the chosen network; never override it.
  if (entry.isNew && stored) return stored

  // Resolve from station identity first — do not pass `fallback` here or every
  // stop without `sourceCollectionId` would inherit GBNR before `stnarea` is checked.
  const fromStationIdentity = entry.original ? getStationNetworkCollectionId(entry.original) : null

  // Prefer the station's actual network over a stale stored target (e.g. default GBNR).
  if (fromStationIdentity) {
    if (!stored || stored !== fromStationIdentity) return fromStationIdentity
    return stored
  }

  return stored ?? fallback
}

/** Normalize a stored pending entry so its target collection matches the station. */
export function migratePendingEntryTarget(entry: PendingChangeEntry): PendingChangeEntry {
  return {
    ...entry,
    targetCollectionId: resolvePendingTargetCollectionId(entry, DEFAULT_NETWORK_COLLECTION_ID),
  }
}

export function filterPendingChangesForCollection(
  pendingChanges: Record<string, PendingChangeEntry>,
  collectionId: StationCollectionId
): Record<string, PendingChangeEntry> {
  const out: Record<string, PendingChangeEntry> = {}
  for (const [id, entry] of Object.entries(pendingChanges)) {
    const target = resolvePendingTargetCollectionId(entry, DEFAULT_NETWORK_COLLECTION_ID)
    if (target === collectionId) {
      out[id] = entry
    }
  }
  return out
}

export function countPendingChangesForCollection(
  pendingChanges: Record<string, PendingChangeEntry>,
  collectionId: StationCollectionId
): number {
  return Object.keys(filterPendingChangesForCollection(pendingChanges, collectionId)).length
}

/** Returns null if all entries share one collection; otherwise an error message. */
export function validateSingleCollectionPending(
  pendingChanges: Record<string, PendingChangeEntry>,
  stationIds: string[]
): { collectionId: StationCollectionId } | { error: string } {
  let collectionId: StationCollectionId | null = null
  for (const id of stationIds) {
    const entry = pendingChanges[id]
    if (!entry) continue
    const target = resolvePendingTargetCollectionId(entry, DEFAULT_NETWORK_COLLECTION_ID)
    if (collectionId == null) {
      collectionId = target
    } else if (collectionId !== target) {
      return {
        error: 'Selected changes target more than one database. Publish or schedule one collection at a time.',
      }
    }
  }
  if (!collectionId) {
    return { error: 'No pending changes selected.' }
  }
  return { collectionId }
}
