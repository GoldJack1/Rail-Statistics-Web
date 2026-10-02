import type { ServiceViewMode } from '@/components/darwin/serviceViewMode'
import { readServiceViewMode } from '@/components/darwin/serviceViewMode'

export const SERVICE_SECTIONS = ['overview', 'loading', 'formation', 'calling', 'raw'] as const
export type ServiceSection = (typeof SERVICE_SECTIONS)[number]

const SERVICE_MODES = ['simple', 'detailed'] as const
const RETURN_KEY = 'rs.service.return'

export function isServiceSection(value: string | null | undefined): value is ServiceSection {
  return SERVICE_SECTIONS.includes(value as ServiceSection)
}

export function isServiceViewMode(value: string | null | undefined): value is ServiceViewMode {
  return value === 'simple' || value === 'detailed'
}

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

/** Darwin RID is 8-digit date + identity. CIF UID is typically 6 chars (G01161). */
export function looksLikeDarwinRid(id: string): boolean {
  return /^\d{8}.+/.test(id)
}

export function parseServicePath(parts: string[]): {
  id: string
  date: string | null
  section: ServiceSection
  mode: ServiceViewMode | null
} {
  const tokens = (parts || []).map((p) => decodeURIComponent(String(p || '')).trim()).filter(Boolean)
  const id = tokens[0] || ''
  let date: string | null = null
  let section: ServiceSection = 'overview'
  let mode: ServiceViewMode | null = null
  for (const token of tokens.slice(1)) {
    if (isIsoDate(token)) date = token
    else if (isServiceSection(token)) section = token
    else if (isServiceViewMode(token)) mode = token
  }
  return { id, date, section, mode }
}

export function serviceHref(opts: {
  id: string
  date: string
  section?: ServiceSection
  mode?: ServiceViewMode
  at?: string | null
}): string {
  const id = encodeURIComponent(String(opts.id || '').trim())
  const date = opts.date
  const section = opts.section && isServiceSection(opts.section) ? opts.section : 'overview'
  const mode = opts.mode && isServiceViewMode(opts.mode) ? opts.mode : readModeSafe()
  const path = `/services/${id}/${date}/${section}/${mode}`
  const at = String(opts.at || '').trim()
  return at ? `${path}?at=${encodeURIComponent(at)}` : path
}

function readModeSafe(): ServiceViewMode {
  try {
    return readServiceViewMode()
  } catch {
    return 'detailed'
  }
}

export function rememberServiceReturn(id: string, date: string, href: string) {
  if (typeof window === 'undefined' || !href) return
  try {
    window.sessionStorage.setItem(`${RETURN_KEY}:${id}:${date}`, href)
    window.sessionStorage.setItem(RETURN_KEY, href)
  } catch {
    /* private mode */
  }
}

export function readServiceReturn(id?: string, date?: string): string {
  if (typeof window === 'undefined') return ''
  try {
    if (id && date) {
      const keyed = window.sessionStorage.getItem(`${RETURN_KEY}:${id}:${date}`)
      if (keyed) return keyed
    }
    return window.sessionStorage.getItem(RETURN_KEY) || ''
  } catch {
    return ''
  }
}

export function consumeLegacyFromParam(from: string | null, id: string, date: string): string {
  if (from) rememberServiceReturn(id, date, from)
  return from || readServiceReturn(id, date)
}

/** Update the address bar without remounting the App Router page. */
export function replaceServiceUrl(href: string) {
  if (typeof window === 'undefined' || !href) return
  const next = new URL(href, window.location.origin)
  const want = `${next.pathname}${next.search}`
  const current = `${window.location.pathname}${window.location.search}`
  if (current === want) return
  window.history.replaceState(window.history.state, '', want)
}

export function goToServicePath(opts: {
  id: string
  date: string
  from?: string
  section?: ServiceSection
  mode?: ServiceViewMode
  at?: string | null
}): string {
  if (opts.from) rememberServiceReturn(opts.id, opts.date, opts.from)
  return serviceHref(opts)
}
