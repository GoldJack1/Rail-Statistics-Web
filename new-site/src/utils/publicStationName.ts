/** Darwin and CORPUS tag Elizabeth line CRS twins with "(Crossrail)". */
export function publicStationName(value: unknown): string {
  return String(value ?? '')
    .replace(/\s*\(Crossrail\)/gi, '')
    .replace(/\s+Crossrail$/i, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function publicStationNameOrNull(value: unknown): string | null {
  const name = publicStationName(value)
  return name || null
}
