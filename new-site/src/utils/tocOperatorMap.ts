/** Pure TOC operator mapping/helpers (safe for Cloud Functions export — no client Firebase). */

import { lookupNreTocCodeName } from './nreTocCodes'

export const TOC_OPERATORS_COLLECTION = 'toc_operators'

export interface TocOperator {
  id: string
  name: string
  colorHex: string
  operatorRegion: string | null
  operatorType: string | null
}

export const TOC_OPERATOR_FALLBACK_COLORS = { bg: '#64748b', text: '#ffffff' }

/** Explicit chip colour overrides (lookup key = normalizeTocLookupKey). */
const TOC_CHIP_COLOR_OVERRIDES: Record<string, string> = {
  'keighley & worth valley railway': '#952530',
  'keighley & worth valley': '#952530',
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toUpperCase()}`
  return null
}

export function mapTocOperatorDoc(id: string, data: Record<string, unknown>): TocOperator | null {
  const name = readString(data, 'name', 'Name', 'toc', 'TOC')
  if (!name) return null
  const colorHex =
    normalizeHexColor(readString(data, 'colorHex', 'colorhex', 'color', 'Colour')) ??
    TOC_OPERATOR_FALLBACK_COLORS.bg
  return {
    id,
    name,
    colorHex,
    operatorRegion: readString(data, 'operatorregion', 'operatorRegion', 'region'),
    operatorType: readString(data, 'operatortype', 'operatorType', 'type'),
  }
}

function relativeLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex) ?? TOC_OPERATOR_FALLBACK_COLORS.bg
  const value = normalized.slice(1)
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

export function getContrastingTextColor(backgroundHex: string): string {
  return relativeLuminance(backgroundHex) > 0.45 ? '#1a1a1a' : '#ffffff'
}

function mixTowardWhite(hex: string, amount: number): string {
  const value = hex.slice(1)
  const channel = (offset: number) => {
    const current = parseInt(value.slice(offset, offset + 2), 16)
    return Math.round(current + (255 - current) * amount)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(2)}${channel(4)}`.toUpperCase()
}

function maxChannel(hex: string): number {
  const value = hex.slice(1)
  return Math.max(
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ) / 255
}

/**
 * A brand colour that is too dark to read on the dark Tracks basemap is
 * stepped toward white until the line has enough contrast. A colour that is
 * already bright, such as a vivid red, stays as it is.
 */
export function liftRouteColorForDarkBasemap(hex: string): string {
  let colour = normalizeHexColor(hex) ?? TOC_OPERATOR_FALLBACK_COLORS.bg
  for (let step = 0; step < 5 && maxChannel(colour) < 0.62; step++) {
    colour = mixTowardWhite(colour, 0.34)
  }
  return colour
}

function normalizeTocLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, ' ')
}

export function findTocOperator(
  operators: TocOperator[],
  tocName: string
): TocOperator | undefined {
  const needle = normalizeTocLookupKey(tocName)
  if (!needle) return undefined
  return operators.find((op) => {
    const name = normalizeTocLookupKey(op.name)
    const id = normalizeTocLookupKey(op.id)
    return name === needle || id === needle
  })
}

export function getTocOperatorChipColors(
  operators: TocOperator[],
  tocName: string
): { bg: string; text: string } {
  const override = TOC_CHIP_COLOR_OVERRIDES[normalizeTocLookupKey(tocName)]
  const match = findTocOperator(operators, tocName)
  const bg = override ?? match?.colorHex ?? TOC_OPERATOR_FALLBACK_COLORS.bg
  return { bg, text: getContrastingTextColor(bg) }
}

/** Brand colour for a service route. Tries the published name, then the TOC code. */
export function resolveTocRouteColor(
  operators: TocOperator[],
  tocCode: string | null | undefined,
  tocName: string | null | undefined,
): string {
  const names = [tocName, lookupNreTocCodeName(String(tocCode || '')), tocCode]
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (!name) continue
    const bg = getTocOperatorChipColors(operators, name).bg
    if (bg.toLowerCase() !== TOC_OPERATOR_FALLBACK_COLORS.bg.toLowerCase()) return bg
  }
  return TOC_OPERATOR_FALLBACK_COLORS.bg
}

/** Canonical display name from the operators catalog when an exact match exists. */
export function resolveTocOperatorDisplayName(
  operators: TocOperator[],
  tocName: string
): string {
  return findTocOperator(operators, tocName)?.name ?? tocName.trim()
}

/**
 * Resolve station TOC labels to catalog display names for a network chip picker.
 * Prefers catalog names when a match exists; keeps unknown station TOC strings.
 */
export function resolveTocChipNamesForNetwork(
  stationTocNames: readonly string[],
  operators: TocOperator[]
): string[] {
  const names = new Set<string>()
  for (const raw of stationTocNames) {
    const resolved = resolveTocOperatorDisplayName(operators, raw)
    if (resolved) names.add(resolved)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/** Resolve NRE two-letter TOC codes (e.g. SE) to a full operator name. */
export function resolveNreTocCodeDisplayName(
  operators: TocOperator[],
  code: string
): string {
  const trimmed = code.trim()
  if (!trimmed) return trimmed

  const byCatalog = findTocOperator(operators, trimmed)
  if (byCatalog) return byCatalog.name

  const mapped = lookupNreTocCodeName(trimmed)
  if (mapped) return resolveTocOperatorDisplayName(operators, mapped)

  return trimmed
}

export function isTocOperatorRecord(value: unknown): value is TocOperator {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.colorHex === 'string'
  )
}
