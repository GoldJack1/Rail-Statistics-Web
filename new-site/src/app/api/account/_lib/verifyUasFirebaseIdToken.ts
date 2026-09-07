/** Shared Firebase ID token verification for UAs account API routes. */

export async function verifyUasFirebaseIdToken(idToken: string): Promise<{
  uid: string
  email: string | null
}> {
  const apiKey = process.env.NEXT_PUBLIC_UAS_FIREBASE_API_KEY?.trim()
  if (!apiKey || apiKey === 'placeholder') {
    throw new Error('User accounts Firebase is not configured.')
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
    }
  )
  const data = (await res.json().catch(() => null)) as
    | {
        users?: Array<{ localId?: string; email?: string }>
        error?: { message?: string }
      }
    | null
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Invalid or expired sign-in.')
  }
  const uid = data?.users?.[0]?.localId?.trim()
  if (!uid) throw new Error('Invalid or expired sign-in.')
  const email = data?.users?.[0]?.email?.trim() || null
  return { uid, email }
}
