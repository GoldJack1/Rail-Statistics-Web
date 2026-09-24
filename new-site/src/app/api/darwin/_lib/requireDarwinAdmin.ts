import { getMasterPublishEmail } from '@/utils/masterPublishPolicy'
import { isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'

type EditorCheck = { ok: true; email: string | null } | { ok: false; error: string }

function readJwtPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function verifyCatalogueStationEditor(idToken: string): Promise<EditorCheck> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()
  if (!apiKey) return { ok: false, error: 'Catalogue Firebase is not configured.' }

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
    | { users?: Array<{ email?: string }>; error?: { message?: string } }
    | null
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || 'Invalid or expired sign-in.' }
  }
  const email = data?.users?.[0]?.email?.trim().toLowerCase() || null
  const payload = readJwtPayload(idToken)
  const hasEditorClaim = payload?.rs_station_editor === true
  const emailOk = Boolean(email && email === getMasterPublishEmail())
  if (!hasEditorClaim && !emailOk) {
    return { ok: false, error: 'Station editor access required.' }
  }
  return { ok: true, email }
}

export async function requireDarwinAdmin(request: Request): Promise<EditorCheck | null> {
  if (isLocalDevLoginBypassEnabled()) return null
  const auth = request.headers.get('authorization') || ''
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!idToken) return { ok: false, error: 'Admin sign-in required.' }
  return verifyCatalogueStationEditor(idToken)
}
