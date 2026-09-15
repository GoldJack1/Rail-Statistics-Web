import { getFirestore, type Firestore } from 'firebase/firestore'

import { ensureFirebaseAppCheck, getFirebaseApp, initializeFirebase } from './firebase'

/** Named Firestore database historically used by D-PAYG and iOS tickets.
 * Public reads now come from Storage (`ticket-catalogs/`); writes still use this DB.
 */
export const TICKETS_FIRESTORE_DATABASE_ID = 'railstatisticstickets'

let ticketsDb: Firestore | null = null

/**
 * Returns a Firestore client bound to `railstatisticstickets`.
 * Auth / App Check share the same Firebase app as the default DB.
 */
export const getTicketsFirestore = async (): Promise<Firestore> => {
  if (ticketsDb) return ticketsDb

  await initializeFirebase()
  // Production may enforce App Check on Firestore; align with other public data reads.
  await ensureFirebaseAppCheck()
  const app = getFirebaseApp()
  if (!app) {
    throw new Error('Firebase app is not initialized.')
  }

  ticketsDb = getFirestore(app, TICKETS_FIRESTORE_DATABASE_ID)
  return ticketsDb
}
