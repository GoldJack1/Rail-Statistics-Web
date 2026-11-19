/**
 * Lean Firebase Analytics bootstrap — no Auth/Firestore/Functions.
 * Keeps gtag off the stations critical path when only logging page views.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import type { Analytics } from 'firebase/analytics'

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

let app: FirebaseApp | null = null
let analytics: Analytics | null = null

async function ensureApp(): Promise<FirebaseApp | null> {
  if (app) return app
  try {
    const authBootstrap = await import('@/services/firebaseAuthBootstrap')
    app = authBootstrap.getFirebaseAuthApp()
  } catch {
    /* ignore */
  }
  if (!app) {
    app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp(firebaseConfig)
  }
  return app
}

export async function ensureFirebaseAnalytics(): Promise<Analytics | null> {
  if (analytics) return analytics
  const firebaseApp = await ensureApp()
  if (!firebaseApp) return null
  try {
    const { getAnalytics } = await import('firebase/analytics')
    analytics = getAnalytics(firebaseApp)
  } catch {
    analytics = null
  }
  return analytics
}
