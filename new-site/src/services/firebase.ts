import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendEmailVerification,
  GoogleAuthProvider,
  OAuthProvider,
  Auth,
  User
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  setDoc,
  deleteDoc,
  GeoPoint,
  connectFirestoreEmulator,
  Firestore,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore'
import { Analytics } from 'firebase/analytics'
import type { Station } from '@/types'
import type { SandboxStationDoc } from '@/types'
import { parseScheduledJobDocForDisplay } from '@/utils/scheduledJobDocParse'
import type { ScheduledJobStationPayload } from '@/utils/scheduledJobPendingMatch'

// Firebase configuration from environment variables (set in Netlify or .env.local)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'placeholder',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'placeholder',
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || 'placeholder',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'placeholder',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'placeholder',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'placeholder',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'placeholder',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'placeholder'
}

const isPlaceholder = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '' || value === 'placeholder'

/**
 * In local development we want to fail fast if Firebase env vars
 * are missing, rather than silently using placeholder config.
 */
const validateFirebaseConfigForDev = (): void => {
  if (process.env.NODE_ENV !== 'development') return

  const missing: string[] = []
  if (isPlaceholder(firebaseConfig.apiKey)) missing.push('NEXT_PUBLIC_FIREBASE_API_KEY')
  if (isPlaceholder(firebaseConfig.authDomain)) missing.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN')
  if (isPlaceholder(firebaseConfig.projectId)) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID')
  if (isPlaceholder(firebaseConfig.appId)) missing.push('NEXT_PUBLIC_FIREBASE_APP_ID')

  if (missing.length > 0) {
    throw new Error(
      `Firebase env vars missing: ${missing.join(
        ', '
      )}. Create a \`.env.local\` (copy from \`.env.example\`) and restart the dev server.`
    )
  }
}

// Avoid logging config in production (reduces noise and env surface in DevTools).
if (process.env.NODE_ENV === 'development') {
  console.log('🔥 Firebase Config Check:')
  console.log(
    '  - API Key:',
    firebaseConfig.apiKey === 'placeholder' ? '❌ NOT LOADED (using placeholder)' : '✅ Loaded (redacted)'
  )
  console.log('  - Project ID:', firebaseConfig.projectId)
  console.log('  - Auth Domain:', firebaseConfig.authDomain)
  console.log('  - Environment:', process.env.NODE_ENV)
  console.log(
    '  - NEXT_PUBLIC_* keys:',
    Object.keys(process.env).filter((k) => k.startsWith('NEXT_PUBLIC_'))
  )
}

// Initialize Firebase
let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let analytics: Analytics | null = null
let appCheckReady = false
let appCheckInflight: Promise<void> | null = null

/**
 * Loads reCAPTCHA / App Check only when auth is needed (login, admin, stations).
 * Keeps marketing pages free of ~400 KiB of unused third-party JS on initial load.
 * App Check is imported dynamically so the reCAPTCHA provider is not in the critical parse path.
 */
export const ensureFirebaseAppCheck = async (): Promise<void> => {
  if (appCheckReady) return
  if (!app) {
    // Callers that only need Firestore (public detail) may reach here before Auth bootstrap.
    await initializeFirebase()
  }
  if (!app) return
  if (appCheckInflight) return appCheckInflight

  appCheckInflight = (async () => {
    const appCheckSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    const appCheckExplicitlyDisabled = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DISABLED === 'true'
    const isDev = process.env.NODE_ENV === 'development'
    const canEnableAppCheck =
      !isDev && !appCheckExplicitlyDisabled && !!appCheckSiteKey && appCheckSiteKey !== 'placeholder'

    if (canEnableAppCheck && app) {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        })
        console.log('🔥 Firebase App Check enabled (reCAPTCHA v3)')
      } catch (error) {
        // Already initialized via auth bootstrap on the same app instance.
        console.warn('🔥 App Check already initialized:', (error as Error).message)
      }
    } else if (!isDev && appCheckExplicitlyDisabled) {
      console.warn(
        '🔥 NEXT_PUBLIC_FIREBASE_APP_CHECK_DISABLED=true — App Check is off in this build. ' +
          'If Firebase still enforces App Check on Authentication, sign-in may fail until you use Monitoring (not enforce) or remove this flag and set a valid NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY.'
      )
    } else if (!isDev && (!appCheckSiteKey || appCheckSiteKey === 'placeholder')) {
      console.warn(
        '🔥 No NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY in this production build. ' +
          'If App Check enforcement is ON for Authentication in Firebase Console, add the reCAPTCHA v3 site key from App Check → your web app, or turn enforcement to Monitoring.'
      )
    }

    appCheckReady = true
  })().finally(() => {
    appCheckInflight = null
  })

  return appCheckInflight
}

export const initializeFirebase = async () => {
  if (app && auth && db) return { app, auth, db, analytics }
  
  try {
    validateFirebaseConfigForDev()
    // Prefer an app already created by the lean auth bootstrap (dynamic to avoid cycles).
    let existingApp: FirebaseApp | null = getApps().find((a) => a.name === '[DEFAULT]') ?? null
    if (!existingApp) {
      try {
        const authBootstrap = await import('@/services/firebaseAuthBootstrap')
        existingApp = authBootstrap.getFirebaseAuthApp()
      } catch {
        /* ignore */
      }
    }
    app = existingApp ?? initializeApp(firebaseConfig)
    auth = getAuth(app)

    db = getFirestore(app)
    
    // Connect to Firebase emulator in development if explicitly enabled
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
      try {
        connectFirestoreEmulator(db, '127.0.0.1', 8080)
        console.log('🔥 Connected to Firebase emulator')
      } catch (emulatorError) {
        console.warn('Firebase emulator connection failed:', (emulatorError as Error).message)
      }
    }

    // Analytics is initialized separately via ensureFirebaseAnalytics so auth/data
    // boot does not pull gtag onto the critical path (stations / admin LCP).
    
    return { app, auth, db, analytics }
  } catch (error) {
    console.error('Firebase initialization failed:', error)
    throw error
  }
}

/** Lazy-load Firebase Analytics / gtag after the page has painted. */
export const ensureFirebaseAnalytics = async (): Promise<Analytics | null> => {
  if (analytics) return analytics
  if (!app) await initializeFirebase()
  if (!app) return null
  try {
    const { getAnalytics } = await import('firebase/analytics')
    analytics = getAnalytics(app)
  } catch {
    analytics = null
  }
  return analytics
}

export const getFirebaseApp = (): FirebaseApp | null => app
export const getFirebaseAuth = (): Auth | null => auth
export const getFirebaseDB = (): Firestore | null => db
export const getFirebaseAnalytics = (): Analytics | null => analytics

/**
 * Dev only: if `NEXT_PUBLIC_LOCAL_AUTH_EMAIL` and `NEXT_PUBLIC_LOCAL_AUTH_PASSWORD` are set in `.env.local`,
 * sign in with Firebase Email/Password before the rest of auth init (so Firestore + scheduled publish work).
 * Never commit real credentials; use only in local `.env.local`.
 */
export const tryDevAutoSignInFromEnv = async (): Promise<void> => {
  if (process.env.NODE_ENV === 'development' !== true) return
  const email = process.env.NEXT_PUBLIC_LOCAL_AUTH_EMAIL?.trim()
  const password = process.env.NEXT_PUBLIC_LOCAL_AUTH_PASSWORD
  if (!email || typeof password !== 'string' || password.length === 0) return
  if (!auth) {
    await initializeFirebase()
  }
  const a = getFirebaseAuth()
  if (!a || a.currentUser) return
  try {
    await signInWithEmailAndPassword(a, email, password)
    console.log('[Rail Statistics][dev] Signed in with Email/Password from NEXT_PUBLIC_LOCAL_AUTH_*')
  } catch (e) {
    console.warn('[Rail Statistics][dev] NEXT_PUBLIC_LOCAL_AUTH_* sign-in failed:', e)
  }
}

// Auth helpers (call after initializeFirebase)
export const loginWithEmail = async (email: string, password: string) => {
  await ensureFirebaseAppCheck()
  return signInWithEmailAndPassword(auth!, email, password)
}
export const logout = () => firebaseSignOut(auth!)

/** Send Firebase email verification (required for verified-email gates in this app). */
export const sendUserEmailVerification = (user: User) => sendEmailVerification(user)

/** Sign in with Google. Uses redirect (no popup) so it works when popups are blocked. */
export const loginWithGoogle = async () => {
  if (!auth) await initializeFirebase().then(() => {})
  await ensureFirebaseAppCheck()
  const a = getFirebaseAuth()
  if (!a) throw new Error('Firebase Auth not initialized')
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithRedirect(a, provider)
  // Page will navigate away to Google; after sign-in user returns and getRedirectResult() runs on load
}

/** Sign in with Apple. Uses redirect (no popup) so it works when popups are blocked. */
export const loginWithApple = async () => {
  if (!auth) await initializeFirebase().then(() => {})
  await ensureFirebaseAppCheck()
  const a = getFirebaseAuth()
  if (!a) throw new Error('Firebase Auth not initialized')
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  await signInWithRedirect(a, provider)
  // Page will navigate away to Apple; after sign-in user returns and getRedirectResult() runs on load
}

/** Call once on app load to complete sign-in after returning from Google/Apple redirect. */
export const handleRedirectResult = async () => {
  const a = getFirebaseAuth()
  if (!a) return null
  return getRedirectResult(a)
}

export { onAuthStateChanged, getRedirectResult }
export type { User }

export {
  NETWORK_COLLECTION_IDS,
  NETWORK_LABELS,
  SANDBOX_COLLECTION_ID,
  STATION_COLLECTION_DISPLAY_LABELS,
  STATION_NETWORK_STORAGE_KEY,
  STATION_COLLECTION_STORAGE_KEY,
  DEFAULT_NETWORK_COLLECTION_ID,
  DEFAULT_NETWORK_VIEW,
  deriveCollectionId,
  getStationCollectionDisplayLabel,
  getNetworkCollectionDisplayLabel,
  isNetworkCollection,
  isSandboxCollection,
  isNetworkViewFilter,
  type NetworkCollectionId,
  type NetworkViewFilter,
  type StationCollectionId,
} from '@/constants/stationCollections'
import { isLightRailCollection, LIGHT_RAIL_DOC_FIELDS } from '@/utils/lightRailStationFields'
import {
  mapFirestoreDocToStation,
  type StationFetchDetailLevel,
} from '@/services/stationFirestoreMapper'
import { parseStationsOffThread } from '@/services/parseStationsOffThread'

export { parseLocationString, type StationFetchDetailLevel } from '@/services/stationFirestoreMapper'

import {
  NETWORK_COLLECTION_IDS,
  type StationCollectionId,
} from '@/constants/stationCollections'
import { getStationCollectionName } from '@/utils/stationCollectionStorage'

export {
  getStationCollectionName,
  getStationNetworkId,
  getStationNetworkView,
  setStationCollectionName,
  setStationNetworkId,
  setStationNetworkView,
} from '@/utils/stationCollectionStorage'

// Fetch stations from Firebase (optional collection override so caller can pass dropdown value at click time)
export const fetchStationsFromFirebase = async (
  collectionOverride?: StationCollectionId,
  options?: { detailLevel?: StationFetchDetailLevel }
): Promise<Station[]> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }

  if (!db) {
    throw new Error('Failed to initialize Firebase database')
  }

  try {
    const collectionName = collectionOverride ?? getStationCollectionName()
    const detailLevel = options?.detailLevel ?? 'full'
    const stationsRef = collection(db, collectionName)
    const snapshot = await getDocs(stationsRef)

    const docs = snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }))

    if (docs.length === 0) {
      return []
    }

    if (docs.length >= 150) {
      return parseStationsOffThread(docs, collectionName, detailLevel)
    }

    return docs.map((doc) =>
      mapFirestoreDocToStation(doc.id, doc.data, collectionName, detailLevel)
    )
    
  } catch (error) {
    console.error('Firebase fetch error:', error)
    throw error
  }
}

/** Fetch and merge stations from every production network collection. */
export const fetchAllNetworkStationsFromFirebase = async (): Promise<Station[]> => {
  const batches = await Promise.all(
    NETWORK_COLLECTION_IDS.map(async (collectionId) => {
      try {
        return await fetchStationsFromFirebase(collectionId)
      } catch (error) {
        console.warn(`Failed to load stations from ${collectionId}:`, error)
        return []
      }
    })
  )
  const merged = batches.flat()
  if (merged.length === 0) {
    throw new Error('No data available in Firebase')
  }
  return merged.sort((a, b) => a.stationName.localeCompare(b.stationName))
}

/**
 * Map our Station type to Firestore document fields (same names as used when reading).
 * Only includes fields that are provided (non-undefined).
 */
const stationToFirestoreUpdate = (
  data: Partial<Station>,
  collectionId?: StationCollectionId
): Record<string, unknown> => {
  const update: Record<string, unknown> = {}
  const isLightRail = isLightRailCollection(collectionId)

  if (isLightRail) {
    if (data.stationName !== undefined) update[LIGHT_RAIL_DOC_FIELDS.stopName] = data.stationName
    if (data.country !== undefined) update.country = data.country
    if (data.county !== undefined) update.county = data.county
    if (data.stnarea !== undefined) update.stnarea = data.stnarea
    if (data.borough !== undefined) update.borough = data.borough
    if (data.fareZone !== undefined && data.fareZone !== null && String(data.fareZone).trim() !== '') {
      update[LIGHT_RAIL_DOC_FIELDS.fareZone] = data.fareZone
    }
  } else {
    if (data.stationName !== undefined) update.stationname = data.stationName
    if (data.crsCode !== undefined) update.CrsCode = data.crsCode
    if (data.tiploc !== undefined) update.tiploc = data.tiploc
    if (data.country !== undefined) update.country = data.country
    if (data.county !== undefined) update.county = data.county
    if (data.toc !== undefined) update.TOC = data.toc
    if (data.stnarea !== undefined) update.stnarea = data.stnarea
    if (data.borough !== undefined) update.borough = data.borough
    if (data.fareZone !== undefined) update.fareZone = data.fareZone
    if (data.yearlyPassengers !== undefined) update.yearlyPassengers = data.yearlyPassengers
  }

  if (data.latitude !== undefined && data.longitude !== undefined) {
    update.location = new GeoPoint(data.latitude, data.longitude)
  }
  return update
}

/** Update a station document in Firestore. */
export const updateStationInFirebase = async (
  stationId: string,
  data: Partial<Station>,
  collectionOverride?: StationCollectionId
): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const collectionName = collectionOverride ?? getStationCollectionName()
  const docRef = doc(db, collectionName, stationId)
  const update = stationToFirestoreUpdate(data, collectionOverride)
  if (Object.keys(update).length === 0) return
  await updateDoc(docRef, { ...update, id: stationId })
}

/** Create a new station document in Firestore with a specific ID. */
export const createStationInFirebase = async (
  stationId: string,
  data: Partial<Station>,
  collectionOverride?: StationCollectionId
): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const collectionName = collectionOverride ?? getStationCollectionName()
  const docRef = doc(db, collectionName, stationId)
  const payload = stationToFirestoreUpdate(data, collectionOverride)
  if (Object.keys(payload).length === 0) {
    throw new Error('No data provided to create station')
  }
  await setDoc(docRef, { ...payload, id: stationId })
}

/**
 * Update "additional details" fields on a station document.
 * This intentionally accepts a partial raw document shape so we can write nested sections
 * like toilets/lift/stepFree/facilities as-is.
 */
export const updateStationAdditionalDetailsInFirebase = async (
  stationId: string,
  data: Partial<SandboxStationDoc>,
  collectionOverride?: StationCollectionId
): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const collectionName = collectionOverride ?? getStationCollectionName()
  const docRef = doc(db, collectionName, stationId)
  const payload = data as Record<string, unknown>
  if (!payload || Object.keys(payload).length === 0) return
  await updateDoc(docRef, payload)
}

/** Create/merge additional details for a station document (safe for new stations). */
export const mergeStationAdditionalDetailsInFirebase = async (
  stationId: string,
  data: Partial<SandboxStationDoc>,
  collectionOverride?: StationCollectionId
): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const collectionName = collectionOverride ?? getStationCollectionName()
  const docRef = doc(db, collectionName, stationId)
  const payload = data as Record<string, unknown>
  if (!payload || Object.keys(payload).length === 0) return
  await setDoc(docRef, payload, { merge: true })
}

/** Sample raw station documents from a collection (for inferring field schema). */
export const fetchStationCollectionSampleDocs = async (
  collectionId: StationCollectionId,
  maxDocs = 40
): Promise<Record<string, unknown>[]> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  // Detail schema sampling needs App Check even when Auth is deferred on public routes.
  await ensureFirebaseAppCheck()
  if (!db) return []
  try {
    const stationsRef = collection(db, collectionId)
    const snapshot = await getDocs(query(stationsRef, limit(maxDocs)))
    const docs: Record<string, unknown>[] = []
    snapshot.forEach((snap) => {
      docs.push(snap.data() as Record<string, unknown>)
    })
    return docs
  } catch (error) {
    console.error('Firebase fetch collection sample docs error:', error)
    return []
  }
}

/** Fetch a single station document by ID from the current collection (for sandbox full-detail modal). */
export const fetchStationDocumentById = async (
  stationId: string,
  collectionOverride?: StationCollectionId
): Promise<Record<string, unknown> | null> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  // Station detail sections (usage/facilities/etc.) live in Firestore — App Check must be ready.
  await ensureFirebaseAppCheck()
  if (!db) return null
  try {
    const collectionName = collectionOverride ?? getStationCollectionName()
    const docRef = doc(db, collectionName, stationId)
    const snapshot = await getDoc(docRef)
    if (!snapshot.exists()) return null
    return snapshot.data() as Record<string, unknown>
  } catch (error) {
    console.error('Firebase fetch station doc error:', error)
    return null
  }
}

/** Firestore collection processed by Cloud Function `processScheduledStationPublishJobs`. */
export const SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION = 'scheduledStationPublishJobs'

/** Summary row for scheduled publish jobs (pending review list + schedule modal). */
export type PendingScheduleJobSummary = {
  id: string
  runAtMs: number
  status: string
  stationIds: string[]
  stationLabels: Record<string, string>
  errorMessage?: string
  collectionId?: string
  /** Set when status is `cancelled` (client writes). */
  cancelReason?: 'user' | 'publish' | 'superseded'
  supersededByJobId?: string
}

export type ScheduleJobSoftCancelMeta =
  | { kind: 'user' }
  | { kind: 'publish' }
  | { kind: 'superseded'; replacedByJobId: string }

export function mapScheduledJobDocToSummary(docId: string, d: Record<string, unknown>): PendingScheduleJobSummary {
  const runAt = d.runAt as { toMillis?: () => number } | undefined
  const runAtMs = typeof runAt?.toMillis === 'function' ? runAt.toMillis() : 0
  const parsed = parseScheduledJobDocForDisplay(d)
  const cr = d.cancelReason
  const cancelReason =
    cr === 'user' || cr === 'publish' || cr === 'superseded' ? (cr as PendingScheduleJobSummary['cancelReason']) : undefined
  const sid = d.supersededByJobId
  return {
    id: docId,
    runAtMs,
    status: String(d.status ?? ''),
    stationIds: parsed.stationIds,
    stationLabels: parsed.stationLabels,
    errorMessage: typeof d.errorMessage === 'string' ? d.errorMessage : undefined,
    collectionId: typeof d.collectionId === 'string' ? d.collectionId : undefined,
    cancelReason,
    supersededByJobId: typeof sid === 'string' && sid.trim() !== '' ? sid : undefined
  }
}

/**
 * Live list of this user’s scheduled jobs (all statuses), newest `runAt` first.
 * Requires Firestore composite index: `createdByUid` + `runAt` (desc).
 */
export function subscribeMyScheduleJobsForUser(
  uid: string,
  onRows: (rows: PendingScheduleJobSummary[]) => void,
  onError: (err: Error) => void,
  maxJobs = 80
): () => void {
  let unsub: (() => void) | undefined
  let cancelled = false

  void initializeFirebase().then(() => {
    if (cancelled) return
    const database = getFirebaseDB()
    if (!database) {
      onError(new Error('Firestore is not available.'))
      return
    }

    const q = query(
      collection(database, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION),
      where('createdByUid', '==', uid),
      orderBy('runAt', 'desc'),
      limit(maxJobs)
    )

    unsub = onSnapshot(
      q,
      snap => {
        onRows(snap.docs.map(docSnap => mapScheduledJobDocToSummary(docSnap.id, docSnap.data() as Record<string, unknown>)))
      },
      err => {
        onError(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })

  return () => {
    cancelled = true
    unsub?.()
  }
}

/** Pending jobs only (for schedule modal radios), soonest `runAt` first. */
export async function fetchMyPendingScheduleJobs(uid: string): Promise<PendingScheduleJobSummary[]> {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) return []

  const q = query(
    collection(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION),
    where('createdByUid', '==', uid),
    where('status', '==', 'pending')
  )
  const snap = await getDocs(q)
  const rows: PendingScheduleJobSummary[] = snap.docs.map(docSnap =>
    mapScheduledJobDocToSummary(docSnap.id, docSnap.data() as Record<string, unknown>)
  )
  rows.sort((a, b) => a.runAtMs - b.runAtMs)
  return rows
}

/** Load `changes` + `runAt` from a pending job doc (for merge-into-existing saves). */
export async function getScheduledStationPublishJobMergeSource(
  jobId: string
): Promise<{ runAtMs: number; changes: Record<string, ScheduledJobStationPayload> } | null> {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) return null

  const snap = await getDoc(doc(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, jobId))
  if (!snap.exists()) return null
  const d = snap.data() as Record<string, unknown>
  if (String(d.status ?? '') !== 'pending') return null
  const runAt = d.runAt as { toMillis?: () => number } | undefined
  const runAtMs = typeof runAt?.toMillis === 'function' ? runAt.toMillis() : 0
  const parsed = parseScheduledJobDocForDisplay(d)
  if (!parsed.scheduledChanges) return null
  return { runAtMs, changes: parsed.scheduledChanges }
}

/**
 * Document id for `scheduledStationPublishJobs`: embeds UTC date/time when the job was created,
 * plus a random suffix so two jobs in the same millisecond cannot collide.
 */
export function buildScheduledStationPublishJobDocId(createdAtMs: number = Date.now()): string {
  const iso = new Date(createdAtMs).toISOString()
  const stamped = iso.replace(/[:.]/g, '-')
  const suffix = Math.random().toString(36).slice(2, 10)
  return `${stamped}_${suffix}`
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) return value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T
  }
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = stripUndefinedDeep(v)
  }
  return out as T
}

/**
 * Create a server-side scheduled publish job (Firestore + Cloud Scheduler function).
 * Requires an authenticated user.
 */
export const createScheduledStationPublishJob = async (params: {
  runAtMs: number
  collectionId: StationCollectionId
  changes: Record<
    string,
    {
      isNew?: boolean
      updated: Partial<Station>
      sandboxUpdated?: Partial<SandboxStationDoc> | null
    }
  >
}): Promise<string> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')

  const authInstance = getFirebaseAuth()
  if (!authInstance) throw new Error('Firebase Auth not initialized')
  const user = authInstance.currentUser
  if (!user) {
    throw new Error('You must be signed in to schedule a publish.')
  }

  const keys = Object.keys(params.changes)
  if (keys.length === 0) throw new Error('No pending changes to schedule')

  const col = collection(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION)
  const jobId = buildScheduledStationPublishJobDocId()
  const docRef = doc(col, jobId)
  await setDoc(docRef, {
    createdAt: serverTimestamp(),
    runAt: Timestamp.fromMillis(params.runAtMs),
    collectionId: params.collectionId,
    createdByUid: user.uid,
    status: 'pending',
    changes: stripUndefinedDeep(params.changes),
    stationIds: keys
  })
  return jobId
}

/** Delete job document (e.g. admin). Prefer soft cancel for normal user flows. */
export const deleteScheduledStationPublishJobDocument = async (jobId: string): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  await deleteDoc(doc(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, jobId))
}

/**
 * If the job is still `pending`, mark it `cancelled` so it remains in history. No-op if missing or not pending.
 * Use after publish-all or when superseding a job during save.
 */
export const softCancelScheduledStationPublishJobDocument = async (
  jobId: string,
  cancelMeta?: ScheduleJobSoftCancelMeta
): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const ref = doc(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, jobId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const st = String((snap.data() as Record<string, unknown>).status ?? '')
  if (st !== 'pending') return
  const payload: Record<string, unknown> = {
    status: 'cancelled',
    cancelledAt: serverTimestamp()
  }
  if (cancelMeta?.kind === 'superseded') {
    payload.cancelReason = 'superseded'
    payload.supersededByJobId = cancelMeta.replacedByJobId
  } else if (cancelMeta?.kind === 'publish') {
    payload.cancelReason = 'publish'
  } else if (cancelMeta?.kind === 'user') {
    payload.cancelReason = 'user'
  }
  await updateDoc(ref, payload)
}

/**
 * After saving a replacement schedule document, ensure the previous job cannot still run as `pending`.
 * Tries soft cancel first (keeps history); if the doc is still pending (e.g. rules blocked update), deletes it.
 */
export const supersedeScheduledStationPublishJobDocument = async (
  supersededJobId: string,
  replacementJobId: string
): Promise<void> => {
  if (!supersededJobId.trim() || !replacementJobId.trim()) return
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const ref = doc(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, supersededJobId)
  try {
    await softCancelScheduledStationPublishJobDocument(supersededJobId, {
      kind: 'superseded',
      replacedByJobId: replacementJobId
    })
  } catch (e) {
    console.warn('Soft cancel superseded schedule job failed:', e)
  }
  let snap = await getDoc(ref)
  if (!snap.exists()) return
  let st = String((snap.data() as Record<string, unknown>).status ?? '')
  if (st !== 'pending') return
  try {
    await deleteScheduledStationPublishJobDocument(supersededJobId)
  } catch (e) {
    console.warn('Could not delete superseded pending schedule job:', e)
  }
}

/**
 * User-initiated cancel: pending jobs only (same as rules). Throws if the job is gone or no longer pending.
 */
export const cancelScheduledStationPublishJobDocument = async (jobId: string): Promise<void> => {
  if (!db) {
    const { db: newDb } = await initializeFirebase()
    db = newDb
  }
  if (!db) throw new Error('Failed to initialize Firebase database')
  const ref = doc(db, SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, jobId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('That schedule no longer exists.')
  }
  const st = String((snap.data() as Record<string, unknown>).status ?? '')
  if (st !== 'pending') {
    throw new Error(
      'Only a pending schedule can be cancelled here. If it is already running, wait for it to finish.'
    )
  }
  await updateDoc(ref, {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    cancelReason: 'user'
  })
}
