import type { DPAYGStation } from '@/types/dpayg'

/** Match a station in a scheme by CRS code or name (case-insensitive). */
export function matchDpaygStation(
  stations: DPAYGStation[],
  query: string
): DPAYGStation | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const crsInParens = trimmed.match(/\(([A-Za-z]{3})\)\s*$/)
  if (crsInParens?.[1]) {
    const byParenCrs = stations.find(
      (s) => s.crs.trim().toUpperCase() === crsInParens[1]!.toUpperCase()
    )
    if (byParenCrs) return byParenCrs
  }

  const needle = trimmed.toLowerCase()
  const byCrs = stations.find((s) => s.crs.trim().toUpperCase() === needle.toUpperCase())
  if (byCrs) return byCrs

  const exactName = stations.find((s) => s.name.trim().toLowerCase() === needle)
  if (exactName) return exactName

  const partial = stations.filter((s) => {
    const hay = `${s.name} ${s.crs}`.toLowerCase()
    return hay.includes(needle)
  })
  if (partial.length === 1) return partial[0]!
  return null
}

/** Stations matching a partial query for suggestion lists. */
export function filterDpaygStations(stations: DPAYGStation[], query: string): DPAYGStation[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return stations
  return stations.filter((s) => {
    const hay = `${s.name} ${s.crs}`.toLowerCase()
    return hay.includes(needle)
  })
}
