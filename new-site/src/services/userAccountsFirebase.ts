/**
 * Secondary Firebase app for consumer accounts + E2EE vault (`rail-statistics-uas`).
 * Catalogue Auth/Firestore stay on the default app — do not mix sessions.
 */
import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

export const UAS_APP_NAME = 'UserAccounts'
export const UAS_FIRESTORE_DATABASE_ID = 'useraccounts'

const uasConfig = {
  apiKey: process.env.NEXT_PUBLIC_UAS_FIREBASE_API_KEY || 'placeholder',
  authDomain: process.env.NEXT_PUBLIC_UAS_FIREBASE_AUTH_DOMAIN || 'placeholder',
  projectId: process.env.NEXT_PUBLIC_UAS_FIREBASE_PROJECT_ID || 'placeholder',
  storageBucket: process.env.NEXT_PUBLIC_UAS_FIREBASE_STORAGE_BUCKET || 'placeholder',
  messagingSenderId: process.env.NEXT_PUBLIC_UAS_FIREBASE_MESSAGING_SENDER_ID || 'placeholder',
  appId: process.env.NEXT_PUBLIC_UAS_FIREBASE_APP_ID || 'placeholder',
  measurementId: process.env.NEXT_PUBLIC_UAS_FIREBASE_MEASUREMENT_ID || 'placeholder',
}

const isPlaceholder = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '' || value === 'placeholder'

function validateUasConfigForDev(): void {
  if (process.env.NODE_ENV !== 'development') return
  const missing: string[] = []
  if (isPlaceholder(uasConfig.apiKey)) missing.push('NEXT_PUBLIC_UAS_FIREBASE_API_KEY')
  if (isPlaceholder(uasConfig.authDomain)) missing.push('NEXT_PUBLIC_UAS_FIREBASE_AUTH_DOMAIN')
  if (isPlaceholder(uasConfig.projectId)) missing.push('NEXT_PUBLIC_UAS_FIREBASE_PROJECT_ID')
  if (isPlaceholder(uasConfig.appId)) missing.push('NEXT_PUBLIC_UAS_FIREBASE_APP_ID')
  if (missing.length > 0) {
    throw new Error(
      `UAs Firebase env vars missing: ${missing.join(', ')}. Add them to \`.env.local\` (see \`.env.local.example\`).`
    )
  }
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null
let appCheckReady = false
let appCheckInflight: Promise<void> | null = null

export function getUasApp(): FirebaseApp | null {
  return app
}

export function getUasAuth(): Auth | null {
  return auth
}

export function getUasFirestore(): Firestore | null {
  return db
}

export function getUasStorage(): FirebaseStorage | null {
  return storage
}

export async function ensureUserAccountsFirebase(): Promise<{
  app: FirebaseApp
  auth: Auth
  db: Firestore
  storage: FirebaseStorage
}> {
  if (app && auth && db && storage) {
    return { app, auth, db, storage }
  }

  validateUasConfigForDev()

  const existing = getApps().find((a) => a.name === UAS_APP_NAME)
  app = existing ?? initializeApp(uasConfig, UAS_APP_NAME)
  // Ensure getApp works for callers that look up by name
  try {
    getApp(UAS_APP_NAME)
  } catch {
    /* already set */
  }

  auth = getAuth(app)
  db = getFirestore(app, UAS_FIRESTORE_DATABASE_ID)
  storage = getStorage(app)

  return { app, auth, db, storage }
}

export async function ensureUasAppCheck(): Promise<void> {
  if (appCheckReady) return
  if (!app) await ensureUserAccountsFirebase()
  if (!app) return
  if (appCheckInflight) return appCheckInflight

  appCheckInflight = (async () => {
    const siteKey =
      process.env.NEXT_PUBLIC_UAS_RECAPTCHA_SITE_KEY || process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    const explicitlyDisabled = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DISABLED === 'true'
    const isDev = process.env.NODE_ENV === 'development'
    const canEnable =
      !isDev && !explicitlyDisabled && !!siteKey && siteKey !== 'placeholder'

    if (canEnable && app) {
      try {
        const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(siteKey!),
          isTokenAutoRefreshEnabled: true,
        })
      } catch (error) {
        console.warn('UAs App Check init:', (error as Error).message)
      }
    }

    appCheckReady = true
  })().finally(() => {
    appCheckInflight = null
  })

  return appCheckInflight
}
