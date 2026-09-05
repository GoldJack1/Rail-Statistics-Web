/**
 * E2EE vault sync (web) — stations-only editor with iOS live parity.
 *
 * - Pull on unlock / restore / Sync now / remote snapshot
 * - Push on visit / favourite / date edits (tickets preserved; devPreferences pass-through only)
 * - Live `onSnapshot` while unlocked; stopped on sign-out
 * - Vault JSON is Swift Codable-safe (ISO8601 dates, base64 ticket Data)
 * - Web never reads or authors `devPreferences` (iOS-only)
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import {
  visitedStationCount,
  type AccountSyncConflictResolution,
  type AccountSyncSnapshot,
} from '@/services/accountModels'
import {
  decodeSnapshotFromJsonBytes,
  encodeSnapshotToJsonBytes,
  extractDevPreferencesJson,
  plaintextNeedsIosCompatibilityRewrite,
} from '@/services/accountSnapshotCodec'
import {
  applySnapshotStationsToDiary,
  buildLocalSnapshotFromDiary,
  getLastSyncedAt,
  getLocalUpdatedAt,
  isLocalDirty,
  markLocalClean,
} from '@/services/stationDiaryStore'
import { ensureUserAccountsFirebase } from '@/services/userAccountsFirebase'
import {
  ACCOUNT_SYNC_SCHEMA_VERSION,
  VAULT_ALG_LABEL,
  bytesToBase64,
  base64ToBytes,
  decryptAesGcmCombined,
  encryptAesGcmCombined,
} from '@/services/vaultCrypto'
import { requireUnlockedVaultKey } from '@/services/vaultKeyStore'

export type SyncConflictContext = {
  local: AccountSyncSnapshot
  cloud: AccountSyncSnapshot
}

export type SyncStatus = {
  isSyncing: boolean
  lastSyncedAt: Date | null
  statusMessage: string | null
  lastError: string | null
  /** Kept for API compatibility — web no longer surfaces conflicts. */
  pendingConflict: SyncConflictContext | null
}

type Listener = (status: SyncStatus) => void

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let remoteUnsub: Unsubscribe | null = null
let remoteListenUid: string | null = null
let writingRemote = false
let applyingRemote = false
/** Cloud `updatedAt` ms last applied or written by this tab. */
let lastHandledRemoteMs = 0
let status: SyncStatus = {
  isSyncing: false,
  lastSyncedAt: getLastSyncedAt(),
  statusMessage: null,
  lastError: null,
  pendingConflict: null,
}
const listeners = new Set<Listener>()

function emit(): void {
  for (const l of listeners) l(status)
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  emit()
}

export function subscribeVaultSync(listener: Listener): () => void {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

export function getVaultSyncStatus(): SyncStatus {
  return status
}

function vaultDocRef(uid: string) {
  return ensureUserAccountsFirebase().then(({ db }) => doc(db, 'vault', uid, 'data', 'snapshot'))
}

/**
 * Live updates when iOS / Android / another browser writes the vault.
 * Idempotent: keeps one listener per uid (matches iOS).
 */
export function startRemoteVaultListening(uid: string): void {
  if (remoteUnsub && remoteListenUid === uid) return
  // Tear down previous listener only — keep lastHandledRemoteMs so the initial
  // snapshot echo does not re-enter pullFromCloud forever.
  remoteUnsub?.()
  remoteUnsub = null
  remoteListenUid = uid
  void vaultDocRef(uid).then((ref) => {
    if (remoteListenUid !== uid) return
    remoteUnsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return
        if (snap.metadata.hasPendingWrites) return
        if (writingRemote || applyingRemote || status.isSyncing) return
        // Don’t clobber in-progress local edits; debounced push will upload them.
        if (isLocalDirty()) return

        const data = snap.data() as Record<string, unknown>
        const updatedAt =
          data.updatedAt instanceof Timestamp
            ? data.updatedAt.toDate()
            : data.updatedAt
              ? new Date(String(data.updatedAt))
              : null
        if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
          const ms = updatedAt.getTime()
          if (ms <= lastHandledRemoteMs) return
          const localMs = getLocalUpdatedAt()?.getTime() ?? 0
          if (ms <= localMs) return
          lastHandledRemoteMs = ms
        }

        void pullFromCloud(uid, { fromRemoteListener: true })
      },
      (err) => {
        console.warn('Vault remote listener failed:', err)
        setStatus({ lastError: err.message })
      }
    )
  })
}

export function stopRemoteVaultListening(): void {
  remoteUnsub?.()
  remoteUnsub = null
  remoteListenUid = null
}

export function handleSignedOutSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = null
  stopRemoteVaultListening()
  lastHandledRemoteMs = 0
  writingRemote = false
  applyingRemote = false
  setStatus({
    pendingConflict: null,
    statusMessage: null,
    lastError: null,
    isSyncing: false,
  })
}

/**
 * Keep cloud ticket blobs when uploading stations from web.
 * `devPreferences` is never taken from the browser model — pass through separately.
 */
function withPreservedCloudTickets(
  local: AccountSyncSnapshot,
  cloud: AccountSyncSnapshot | null
): AccountSyncSnapshot {
  if (!cloud) return local
  return {
    ...local,
    singlesJSON: cloud.singlesJSON,
    returnsJSON: cloud.returnsJSON,
    rangersJSON: cloud.rangersJSON,
    roversJSON: cloud.roversJSON,
    travelcardsJSON: cloud.travelcardsJSON,
    dpaygJSON: cloud.dpaygJSON,
  }
}

type FetchedVault = {
  snapshot: AccountSyncSnapshot
  /** Opaque cloud prefs JSON — web does not read or author this. */
  devPreferencesJson: unknown
}

export async function fetchCloudSnapshot(
  uid: string,
  key: Uint8Array
): Promise<AccountSyncSnapshot | null> {
  const fetched = await fetchCloudSnapshotDetailed(uid, key)
  return fetched?.snapshot ?? null
}

async function fetchCloudSnapshotDetailed(
  uid: string,
  key: Uint8Array
): Promise<FetchedVault | null> {
  const ref = await vaultDocRef(uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) return null
  const data = snap.data() as Record<string, unknown>
  const ciphertextBase64 = String(data.ciphertextBase64 ?? '')
  if (!ciphertextBase64) return null
  const combined = base64ToBytes(ciphertextBase64)
  const plain = await decryptAesGcmCombined(combined, key)
  try {
    const snapshot = decodeSnapshotFromJsonBytes(plain)
    const devPreferencesJson = extractDevPreferencesJson(plain)
    // Quietly normalize date-only / ticket-array payloads so iOS can keep reading.
    if (plaintextNeedsIosCompatibilityRewrite(plain)) {
      await writeEncryptedSnapshot(withPreservedCloudTickets(snapshot, snapshot), uid, key, {
        markClean: false,
        passThroughDevPreferences: devPreferencesJson,
      })
    }
    return { snapshot, devPreferencesJson }
  } catch (e) {
    console.warn('Failed to decode vault snapshot JSON:', e)
    throw new Error('Cloud sync data could not be read.')
  }
}

async function writeEncryptedSnapshot(
  snapshot: AccountSyncSnapshot,
  uid: string,
  key: Uint8Array,
  options?: { markClean?: boolean; passThroughDevPreferences?: unknown }
): Promise<void> {
  const markClean = options?.markClean !== false
  const toUpload: AccountSyncSnapshot = {
    ...snapshot,
    schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
    updatedAt: snapshot.updatedAt,
  }
  const plain = encodeSnapshotToJsonBytes(toUpload, {
    passThroughDevPreferences: options?.passThroughDevPreferences,
  })
  const combined = await encryptAesGcmCombined(plain, key)
  const ref = await vaultDocRef(uid)
  // Stamp handled time before clearing writingRemote so our own echo is ignored.
  lastHandledRemoteMs = toUpload.updatedAt.getTime()
  writingRemote = true
  try {
    await setDoc(ref, {
      schemaVersion: ACCOUNT_SYNC_SCHEMA_VERSION,
      updatedAt: Timestamp.fromDate(toUpload.updatedAt),
      ciphertextBase64: bytesToBase64(combined),
      alg: VAULT_ALG_LABEL,
      writtenAt: serverTimestamp(),
    })
  } finally {
    writingRemote = false
  }
  if (markClean) {
    markLocalClean(toUpload.updatedAt)
    setStatus({ lastSyncedAt: new Date(), lastError: null })
  }
}

type PullOptions = { fromRemoteListener?: boolean }

/** Pull cloud stations into the browser diary (source of truth for load). */
export async function pullFromCloud(uid: string, options?: PullOptions): Promise<void> {
  if (status.isSyncing && options?.fromRemoteListener) return
  setStatus({ isSyncing: true, lastError: null, statusMessage: null, pendingConflict: null })
  applyingRemote = true
  try {
    const key = requireUnlockedVaultKey()
    const fetched = await fetchCloudSnapshotDetailed(uid, key)
    const cloud = fetched?.snapshot ?? null
    if (!cloud) {
      startRemoteVaultListening(uid)
      setStatus({ statusMessage: 'No cloud sync data yet — mark a station to create it.' })
      return
    }
    applySnapshotStationsToDiary(cloud)
    markLocalClean(cloud.updatedAt)
    lastHandledRemoteMs = Math.max(lastHandledRemoteMs, cloud.updatedAt.getTime())
    startRemoteVaultListening(uid)
    setStatus({
      statusMessage: `Loaded from cloud sync (${visitedStationCount(cloud)} visited).`,
      lastSyncedAt: new Date(),
    })
  } catch (e) {
    console.warn('Vault pull failed:', e)
    setStatus({ lastError: e instanceof Error ? e.message : String(e) })
  } finally {
    applyingRemote = false
    setStatus({ isSyncing: false })
  }
}

/** Push browser station diary to cloud; preserve tickets; pass through cloud devPreferences. */
export async function pushStationsToCloud(uid: string): Promise<void> {
  setStatus({ isSyncing: true, lastError: null })
  try {
    const key = requireUnlockedVaultKey()
    const fetched = await fetchCloudSnapshotDetailed(uid, key)
    const cloud = fetched?.snapshot ?? null
    const local = buildLocalSnapshotFromDiary()
    const localEmpty = Object.keys(local.stationsLocal).length === 0
    const cloudHasStations = Boolean(cloud && Object.keys(cloud.stationsLocal).length > 0)

    // Never wipe iOS/Android stations with an empty browser diary.
    if (localEmpty && cloudHasStations) {
      applyingRemote = true
      try {
        applySnapshotStationsToDiary(cloud!)
        markLocalClean(cloud!.updatedAt)
        lastHandledRemoteMs = Math.max(lastHandledRemoteMs, cloud!.updatedAt.getTime())
      } finally {
        applyingRemote = false
      }
      startRemoteVaultListening(uid)
      setStatus({
        statusMessage: `Loaded from cloud sync (${visitedStationCount(cloud!)} visited).`,
        lastSyncedAt: new Date(),
      })
      return
    }

    local.updatedAt = new Date()
    const toUpload = withPreservedCloudTickets(local, cloud)
    await writeEncryptedSnapshot(toUpload, uid, key, {
      passThroughDevPreferences: fetched?.devPreferencesJson,
    })
    startRemoteVaultListening(uid)
    setStatus({ statusMessage: 'Saved stations to cloud sync.' })
  } catch (e) {
    console.warn('Vault push failed:', e)
    setStatus({ lastError: e instanceof Error ? e.message : String(e) })
  } finally {
    setStatus({ isSyncing: false })
  }
}

/** First unlock after recovery key — always pull cloud. */
export async function reconcileAfterUnlock(uid: string): Promise<void> {
  await pullFromCloud(uid)
  startRemoteVaultListening(uid)
}

/** Remembered-device restore — always pull cloud. */
export async function syncAfterRestore(uid: string): Promise<void> {
  await pullFromCloud(uid)
  startRemoteVaultListening(uid)
}

/** Manual Sync now — pull from cloud. */
export async function syncNow(uid: string): Promise<void> {
  await pullFromCloud(uid)
  startRemoteVaultListening(uid)
}

/** Debounced push after visit / favourite / date edits. */
export function scheduleDebouncedUpload(uid: string): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void pushStationsToCloud(uid)
  }, 800)
}

/** No-op: web no longer prompts for conflicts. */
export async function resolveConflict(
  _uid: string,
  _resolution: AccountSyncConflictResolution
): Promise<void> {
  setStatus({ pendingConflict: null })
}

export function conflictSummary(ctx: SyncConflictContext) {
  return {
    localVisited: visitedStationCount(ctx.local),
    cloudVisited: visitedStationCount(ctx.cloud),
    localTickets: 0,
    cloudTickets: 0,
    localNewer: ctx.local.updatedAt.getTime() >= ctx.cloud.updatedAt.getTime(),
  }
}
