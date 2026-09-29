export const OTHER_BAND_SLUG = 'other'

export type ClassBand = {
  slug: string
  label: string
  start: number | null
  end: number | null
}

export function fleetClassNumber(fleetId: string | null | undefined): number | null {
  const match = String(fleetId || '').trim().match(/(\d{1,4})/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export function bandForClassNumber(n: number): ClassBand {
  const start = Math.floor(n / 100) * 100
  const end = start + 99
  return {
    slug: `${start}-${end}`,
    label: `${start}–${end}`,
    start,
    end,
  }
}

export function bandForFleetId(fleetId: string | null | undefined): ClassBand {
  const n = fleetClassNumber(fleetId)
  if (n == null) {
    return { slug: OTHER_BAND_SLUG, label: 'Other', start: null, end: null }
  }
  return bandForClassNumber(n)
}

export function parseBandSlug(slug: string): ClassBand | null {
  const raw = String(slug || '').trim()
  if (raw === OTHER_BAND_SLUG) {
    return { slug: OTHER_BAND_SLUG, label: 'Other', start: null, end: null }
  }
  const match = raw.match(/^(\d+)-(\d+)$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
  return { slug: `${start}-${end}`, label: `${start}–${end}`, start, end }
}

export function classKey(fleetId: string | null | undefined): string {
  const n = fleetClassNumber(fleetId)
  if (n == null) return String(fleetId || 'Unknown').trim() || 'Unknown'
  return String(n)
}

export function fleetMatchesClass(fleetId: string | null | undefined, classId: string): boolean {
  const wanted = String(classId || '').trim()
  if (!wanted) return false
  const raw = String(fleetId || '').trim()
  if (raw === wanted) return true
  return classKey(raw) === wanted
}

export function fleetInBand(fleetId: string, band: ClassBand): boolean {
  const n = fleetClassNumber(fleetId)
  if (band.slug === OTHER_BAND_SLUG) return n == null
  if (band.start == null || band.end == null) return false
  return n != null && n >= band.start && n <= band.end
}

export function withUnitDay(path: string, selectedDay: string): string {
  if (!selectedDay || selectedDay === 'all') return path
  const qs = new URLSearchParams()
  qs.set('unitDay', selectedDay)
  return `${path}?${qs.toString()}`
}
