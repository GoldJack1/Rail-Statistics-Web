export type ParsedMatrixDestination = {
  destCrs: string
  destName: string
  destZone?: string
  fares: {
    peakStandardPence: number
    peakRailcardEstPence: number
    offPeakStandardPence: number
    offPeakRailcardEstPence: number
  }
  dailyCapPence: number
  weeklyCapPence: number
  hasOffPeak: boolean
  notes?: string
}

export type PaygZoneCapBandLike = {
  id: string
  title: string
  minZone: number
  maxZone: number
  dailyCapPence: number
  weeklyCapPence: number
}

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

export const asPence = (...values: unknown[]): number => {
  for (const value of values) {
    const n = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(n) && n > 0) return Math.round(n)
  }
  return 0
}

export const asInt = (value: unknown): number | undefined => {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : undefined
}

export function parseMatrixDestination(
  destCrs: string,
  raw: unknown
): ParsedMatrixDestination | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const destName = asString(row.destName).trim()
  if (!destName) return null
  const peak = asPence(row.paygPeakPence, row.anytimeSinglePence, row.singlePence, row.cashSinglePence)
  const offPeak = asPence(row.paygOffPeakPence, row.offPeakSinglePence)
  const dailyCapPence = asPence(row.dailyCapPence)
  const weeklyCapPence = asPence(row.weeklyCapPence)
  if (peak <= 0 && offPeak <= 0 && dailyCapPence <= 0 && weeklyCapPence <= 0) return null
  const peakStandard = peak > 0 ? peak : offPeak
  const notes = asString(row.notes).trim()
  const destZone = asString(row.destZone).trim()
  return {
    destCrs: destCrs.trim().toUpperCase(),
    destName,
    ...(destZone ? { destZone } : {}),
    fares: {
      peakStandardPence: peakStandard,
      peakRailcardEstPence: 0,
      offPeakStandardPence: offPeak > 0 ? offPeak : peakStandard,
      offPeakRailcardEstPence: 0,
    },
    dailyCapPence,
    weeklyCapPence,
    hasOffPeak: offPeak > 0,
    ...(notes ? { notes } : {}),
  }
}

export function parsePaygZoneNumbers(raw?: string | null): number[] {
  const text = (raw ?? '').trim()
  if (!text || text.toUpperCase() === 'NA') return []
  return text
    .split(/[+/,–—\-]/)
    .map((part) => Number.parseInt(part.replace(/^[^\d-]*/, '').trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

export function zoneRangeFromCapLabel(raw?: string | null): { minZone: number; maxZone: number } | null {
  const numbers = parsePaygZoneNumbers((raw ?? '').replace(/zones?/gi, ' '))
  if (numbers.length === 0) return null
  return {
    minZone: Math.min(...numbers),
    maxZone: Math.max(...numbers),
  }
}

export function formatPaygZoneLabel(raw?: string | null): string {
  const text = (raw ?? '').trim()
  if (!text || text.toUpperCase() === 'NA') return ''
  if (/^zones?\b/i.test(text)) return text
  const numbers = parsePaygZoneNumbers(text)
  if (numbers.length === 0) return `Zone ${text}`
  if (numbers.length === 1 && !/[+/]/.test(text)) return `Zone ${numbers[0]}`
  return `Zones ${text}`
}

export function matchZoneCapBand(
  bands: PaygZoneCapBandLike[],
  originZone?: string | null,
  destZone?: string | null,
  dailyCapPence?: number,
  weeklyCapPence?: number
): PaygZoneCapBandLike | null {
  if (bands.length === 0) return null
  const daily = dailyCapPence && dailyCapPence > 0 ? dailyCapPence : 0
  const weekly = weeklyCapPence && weeklyCapPence > 0 ? weeklyCapPence : 0
  if (daily > 0 || weekly > 0) {
    const byPence = bands.find(
      (band) =>
        (daily <= 0 || band.dailyCapPence === daily) &&
        (weekly <= 0 || band.weeklyCapPence === weekly)
    )
    if (byPence) return byPence
  }
  const originNumbers = parsePaygZoneNumbers(originZone)
  const destNumbers = parsePaygZoneNumbers(destZone)
  if (originNumbers.length === 0 || destNumbers.length === 0) return null
  const min = Math.min(...originNumbers, ...destNumbers)
  const max = Math.max(...originNumbers, ...destNumbers)
  const covering = bands
    .filter((band) => band.minZone <= min && band.maxZone >= max)
    .sort(
      (a, b) =>
        a.maxZone - a.minZone - (b.maxZone - b.minZone) || a.minZone - b.minZone
    )
  return covering[0] ?? null
}

export function parseZoneCapBands(value: unknown): PaygZoneCapBandLike[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const title = asString(row.type || row.title || row.zoneRange).trim()
      const fromTitle = zoneRangeFromCapLabel(title)
      const minZone = asInt(row.minZone) ?? fromTitle?.minZone ?? 0
      const maxZone = asInt(row.maxZone) ?? fromTitle?.maxZone ?? minZone
      const dailyCapPence = asPence(row.dailyCapPence)
      const weeklyCapPence = asPence(row.weeklyCapPence)
      if (!title) return null
      return {
        id: asString(row.id) || `band-${index}`,
        title,
        minZone,
        maxZone,
        dailyCapPence,
        weeklyCapPence,
      }
    })
    .filter((band): band is NonNullable<typeof band> => band != null)
    .sort((a, b) => a.minZone - b.minZone || a.maxZone - b.maxZone)
}

function isThreeLetterCrs(value: string): boolean {
  return /^[A-Z]{3}$/.test(value)
}

export function parseMatrixMetaStations(value: unknown): {
  crs: string
  name: string
  zone?: string
  displayCrs?: string
}[] {
  if (!Array.isArray(value)) return []
  const stations: {
    crs: string
    name: string
    zone?: string
    displayCrs?: string
  }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const key = asString(row.originId || row.naptanId || row.crs || row.id).trim().toUpperCase()
    const name = asString(row.name || row.originName).trim()
    if (!key || !name) continue
    const zone = asString(row.zone).trim()
    const displayCrsRaw = asString(row.crs).trim().toUpperCase()
    const displayCrs =
      displayCrsRaw && isThreeLetterCrs(displayCrsRaw) && displayCrsRaw !== key
        ? displayCrsRaw
        : undefined
    stations.push({
      crs: key,
      name,
      ...(zone ? { zone } : {}),
      ...(displayCrs ? { displayCrs } : {}),
    })
  }
  return stations
}

export function parseTfLMetaCapBands(value: unknown): PaygZoneCapBandLike[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const title = asString(row.zoneRange || row.title || row.type).trim()
      if (!title) return null
      const numbers = parsePaygZoneNumbers(title.replace(/zones?/i, ''))
      const minZone = numbers[0] ?? 0
      const maxZone = numbers[numbers.length - 1] ?? minZone
      const dailyCapPence = asPence(row.dailyPeakPence, row.dailyOffPeakPence, row.dailyCapPence)
      const weeklyCapPence = asPence(row.weeklyMonSunPence, row.travelcard7DayPence, row.weeklyCapPence)
      if (dailyCapPence <= 0 && weeklyCapPence <= 0) return null
      return {
        id: asString(row.id) || `tfl-cap-${index}`,
        title,
        minZone,
        maxZone,
        dailyCapPence,
        weeklyCapPence,
      }
    })
    .filter((band): band is NonNullable<typeof band> => band != null)
}
