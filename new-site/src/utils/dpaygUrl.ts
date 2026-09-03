import type { DPAYGScheme } from '@/types/dpayg'
import { slugifyStationPathSegment } from '@/utils/stationAreaSlug'

/** Public path prefix for D-PAYG fare lookup. */
export const DPAYG_FARES_BASE_PATH = '/d-payg-fares'

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

export function findSchemeByAreaSlug(
  schemes: readonly DPAYGScheme[],
  areaSlug: string
): DPAYGScheme | null {
  const needle = areaSlug.trim().toLowerCase()
  if (!needle) return null
  return (
    schemes.find((scheme) => getDpaygAreaSlug(scheme) === needle) ??
    schemes.find((scheme) => slugifyStationPathSegment(scheme.id) === needle) ??
    null
  )
}

/** Origin–destination segment — e.g. SHF + MHS → "shf-mhs". */
export function buildDpaygOdSlug(originCrs: string, destCrs: string): string {
  return `${originCrs.trim().toLowerCase()}-${destCrs.trim().toLowerCase()}`
}

/** Parse "shf-mhs" (UK CRS codes are 3 letters). */
export function parseDpaygOdSlug(
  odSlug: string
): { originCrs: string; destCrs: string } | null {
  const match = odSlug
    .trim()
    .toLowerCase()
    .match(/^([a-z]{3})-([a-z]{3})$/)
  if (!match) return null
  const originCrs = match[1].toUpperCase()
  const destCrs = match[2].toUpperCase()
  if (originCrs === destCrs) return null
  return { originCrs, destCrs }
}

export function buildDpaygFaresPath(areaSlug: string, odSlug?: string | null): string {
  const area = areaSlug.trim().toLowerCase()
  if (!area) return DPAYG_FARES_BASE_PATH
  const od = odSlug?.trim().toLowerCase()
  if (od) return `${DPAYG_FARES_BASE_PATH}/${area}/${od}`
  return `${DPAYG_FARES_BASE_PATH}/${area}`
}
