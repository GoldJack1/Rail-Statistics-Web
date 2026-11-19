/**
 * Lean Firebase Auth bootstrap — no Firestore / Functions / Analytics.
 * Used by AuthContext so public pages do not sync-parse the monolith SDK.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
  type Auth,
  type User,
  type Unsubscribe,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'placeholder',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'placeholder',
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || 'placeholder',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'placeholder',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'placeholder',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || 'placeholder',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || 'placeholder',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'placeholder',
}

const isPlaceholder = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '' || value === 'placeholder'

let app: FirebaseApp | null = null
let auth: Auth | null = null
let appCheckReady = false
let appCheckInflight: Promise<void> | null = null

function validateFirebaseConfigForDev(): void {
  if (process.env.NODE_ENV !== 'development') return
  const missing: string[] = []
  if (isPlaceholder(firebaseConfig.apiKey)) missing.push('NEXT_PUBLIC_FIREBASE_API_KEY')
  if (isPlaceholder(firebaseConfig.authDomain)) missing.push('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN')
  if (isPlaceholder(firebaseConfig.projectId)) missing.push('NEXT_PUBLIC_FIREBASE_PROJECT_ID')
  if (isPlaceholder(firebaseConfig.appId)) missing.push('NEXT_PUBLIC_FIREBASE_APP_ID')
  if (missing.length > 0) {
    throw new Error(
      `Firebase env vars missing: ${missing.join(', ')}. Create a \`.env.local\` and restart the dev server.`
    )
  }
}

/** Shared app instance — Firestore bootstrap reuses this when present. */
export function getFirebaseAuthApp(): FirebaseApp | null {
  return app
}

export function getFirebaseAuthInstance(): Auth | null {
  return auth
}

export async function ensureFirebaseAuthApp(): Promise<{ app: FirebaseApp; auth: Auth }> {
  if (app && auth) return { app, auth }

  validateFirebaseConfigForDev()
  app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig)
  auth = getAuth(app)
  return { app, auth }
}

export async function ensureFirebaseAppCheck(): Promise<void> {
  if (appCheckReady || !app) return
  if (appCheckInflight) return appCheckInflight

  appCheckInflight = (async () => {
    const appCheckSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
    const appCheckExplicitlyDisabled = process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DISABLED === 'true'
    const isDev = process.env.NODE_ENV === 'development'
    const canEnableAppCheck =
      !isDev && !appCheckExplicitlyDisabled && !!appCheckSiteKey && appCheckSiteKey !== 'placeholder'

    if (canEnableAppCheck && app) {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      })
    }

    appCheckReady = true
  })().finally(() => {
    appCheckInflight = null
  })

  return appCheckInflight
}

export async function tryDevAutoSignInFromEnv(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return
  const email = process.env.NEXT_PUBLIC_LOCAL_AUTH_EMAIL?.trim()
  const password = process.env.NEXT_PUBLIC_LOCAL_AUTH_PASSWORD
  if (!email || typeof password !== 'string' || password.length === 0) return
  await ensureFirebaseAuthApp()
  if (!auth || auth.currentUser) return
  try {
    await signInWithEmailAndPassword(auth, email, password)
  } catch (e) {
    console.warn('[Rail Statistics][dev] NEXT_PUBLIC_LOCAL_AUTH_* sign-in failed:', e)
  }
}

export async function handleRedirectResult(): Promise<{ user: User } | null> {
  await ensureFirebaseAuthApp()
  if (!auth) return null
  const result = await getRedirectResult(auth)
  return result?.user ? { user: result.user } : null
}

export function subscribeAuthState(callback: (user: User | null) => void): Unsubscribe {
  if (!auth) throw new Error('Firebase Auth not initialized')
  return onAuthStateChanged(auth, callback)
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  await ensureFirebaseAuthApp()
  await ensureFirebaseAppCheck()
  await signInWithEmailAndPassword(auth!, email, password)
}

export async function loginWithGoogle(): Promise<void> {
  await ensureFirebaseAuthApp()
  await ensureFirebaseAppCheck()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithRedirect(auth!, provider)
}

export async function loginWithApple(): Promise<void> {
  await ensureFirebaseAuthApp()
  await ensureFirebaseAppCheck()
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  await signInWithRedirect(auth!, provider)
}

export async function logout(): Promise<void> {
  await ensureFirebaseAuthApp()
  await firebaseSignOut(auth!)
}

export type { User }
