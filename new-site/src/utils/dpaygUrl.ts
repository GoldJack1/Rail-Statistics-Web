import type { DPAYGScheme } from '@/types/dpayg'
import { slugifyStationPathSegment } from '@/utils/stationAreaSlug'

/** Public path prefix for D-PAYG fare lookup. */
export const DPAYG_FARES_BASE_PATH = '/d-payg-fares'

/** Fares hub (product type + network cards). */
export const FARES_HUB_BASE_PATH = '/fares'

export const FARES_HUB_SECTION_IDS = ['contactless', 'smartcards', 'd-payg'] as const
export type FaresHubSectionId = (typeof FARES_HUB_SECTION_IDS)[number]

export const FARES_HUB_SECTIONS: ReadonlyArray<{
  id: FaresHubSectionId
  label: string
  searchBase: string
}> = [
  { id: 'contactless', label: 'Contactless', searchBase: '/contactless-fares' },
  { id: 'smartcards', label: 'Smartcards', searchBase: '/smartcard-fares' },
  { id: 'd-payg', label: 'D-PAYG', searchBase: DPAYG_FARES_BASE_PATH },
]

export function isFaresHubSectionId(value: string): value is FaresHubSectionId {
  return (FARES_HUB_SECTION_IDS as readonly string[]).includes(value)
}

export function buildFaresHubPath(sectionId: FaresHubSectionId = 'contactless'): string {
  return `${FARES_HUB_BASE_PATH}/${sectionId}`
}

export function hubPathForSearchBase(basePath: string): string {
  const root = basePath.replace(/\/$/, '') || '/'
  const row = FARES_HUB_SECTIONS.find((section) => section.searchBase === root)
  return row ? buildFaresHubPath(row.id) : buildFaresHubPath()
}

/**
 * Area segment from scheme label — e.g. "Sheffield–Doncaster" → "sheffield-doncaster".
 * Prefer shortName (tab label), then name, then id.
 */
export function getDpaygAreaSlug(
  scheme: Pick<DPAYGScheme, 'shortName' | 'name' | 'id'>
): string {
  const label = (scheme.shortName || scheme.name || scheme.id).replace(/[–—]/g, '-')
  return slugifyStationPathSegment(label)
}

export function findSchemeByAreaSlug<T extends DPAYGScheme>(
  schemes: readonly T[],
  areaSlug: string
): T | null {
  const needle = areaSlug.trim().toLowerCase()
  if (!needle) return null
  return (
    schemes.find((scheme) => getDpaygAreaSlug(scheme) === needle) ??
    schemes.find((scheme) => slugifyStationPathSegment(scheme.id) === needle) ??
    null
  )
}

/** Origin–destination segment — e.g. SHF + MHS → "shf-mhs", Naptan ids use "~". */
export function buildDpaygOdSlug(originCrs: string, destCrs: string): string {
  const origin = originCrs.trim().toLowerCase()
  const dest = destCrs.trim().toLowerCase()
  if (origin.length !== 3 || dest.length !== 3) return `${origin}~${dest}`
  return `${origin}-${dest}`
}

/** Parse "shf-mhs" (CRS) or "naptan~naptan". */
export function parseDpaygOdSlug(
  odSlug: string
): { originCrs: string; destCrs: string } | null {
  const raw = odSlug.trim().toLowerCase()
  const tilde = raw.split('~')
  if (tilde.length === 2 && tilde[0] && tilde[1] && tilde[0] !== tilde[1]) {
    return { originCrs: tilde[0].toUpperCase(), destCrs: tilde[1].toUpperCase() }
  }
  const match = raw.match(/^([a-z]{3})-([a-z]{3})$/)
  if (!match) return null
  const originCrs = match[1].toUpperCase()
  const destCrs = match[2].toUpperCase()
  if (originCrs === destCrs) return null
  return { originCrs, destCrs }
}

export function buildPaygFaresPath(
  basePath: string,
  areaSlug: string,
  odSlug?: string | null,
  subSlug?: string | null
): string {
  const root = basePath.replace(/\/$/, '') || '/'
  const area = areaSlug.trim().toLowerCase()
  if (!area) return root
  const sub = subSlug?.trim().toLowerCase()
  const od = odSlug?.trim().toLowerCase()
  const parts = [root, area]
  if (sub) parts.push(sub)
  if (od) parts.push(od)
  return parts.join('/')
}

export function buildDpaygFaresPath(areaSlug: string, odSlug?: string | null): string {
  return buildPaygFaresPath(DPAYG_FARES_BASE_PATH, areaSlug, odSlug)
}
