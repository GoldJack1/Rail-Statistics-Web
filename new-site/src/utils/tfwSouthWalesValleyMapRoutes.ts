/** TfW South Wales valley lines that run into Cardiff Central. */

export const TFW_SOUTH_WALES_AREA_IDS = new Set(['tfw-south-wales', 'contactless_TFW_southwales'])

/** Merthyr, Aberdare and Treherbert services, including the shared line as far as Radyr. */
export const TFW_VALLEY_NORTH_CRS = new Set([
  'MER',
  'PTB',
  'TRD',
  'MEV',
  'QYD',
  'ACY',
  'ABA',
  'CMH',
  'FER',
  'MTA',
  'PER',
  'TRB',
  'YNW',
  'TRY',
  'TPN',
  'YSR',
  'LLY',
  'TNP',
  'DMG',
  'POR',
  'TRH',
  'PPD',
  'TRF',
  'TRE',
  'TAF',
  'RDR',
])

const QUEEN_STREET_VIA_CRS = ['LLN', 'CYS', 'CDQ'] as const
const CITY_LINE_VIA_CRS = ['DCT', 'FRW', 'WNG', 'NNP'] as const
const CARDIFF_CENTRAL_CRS = 'CDF'
const RADYR_CRS = 'RDR'

export function isTfwSouthWalesPaygArea(areaId: string | undefined | null): boolean {
  if (!areaId) return false
  return TFW_SOUTH_WALES_AREA_IDS.has(areaId)
}

export function isTfwValleyNorthCrs(crs: string): boolean {
  return TFW_VALLEY_NORTH_CRS.has(crs.trim().toUpperCase())
}

export type TfwValleyJourneyPlan = {
  /** CRS sequences for BRouter (origin → vias → dest). */
  routes: string[][]
}

function normalizeCrs(crs: string): string {
  return crs.trim().toUpperCase()
}

function uniqueCrs(sequence: string[]): string[] {
  const out: string[] = []
  for (const crs of sequence) {
    if (out[out.length - 1] === crs) continue
    out.push(crs)
  }
  return out
}

/**
 * When a TfW South Wales journey involves a Merthyr / Treherbert / Aberdare line station,
 * force the map line into Cardiff Central via Queen Street (Llandaf, Cathays) and via Ninian Park.
 */
export function planTfwSouthWalesValleyJourney(
  originCrs: string,
  destCrs: string
): TfwValleyJourneyPlan | null {
  const origin = normalizeCrs(originCrs)
  const dest = normalizeCrs(destCrs)
  if (!origin || !dest || origin === dest) return null

  const originValley = isTfwValleyNorthCrs(origin)
  const destValley = isTfwValleyNorthCrs(dest)
  if (originValley === destValley) return null

  const valleyCrs = originValley ? origin : dest
  const otherCrs = originValley ? dest : origin
  const queenStreetVia = [...QUEEN_STREET_VIA_CRS]
  const cityLineVia = [RADYR_CRS, ...CITY_LINE_VIA_CRS]

  const towardsCentralQueen = uniqueCrs([valleyCrs, ...queenStreetVia, CARDIFF_CENTRAL_CRS])
  const towardsCentralCity = uniqueCrs([valleyCrs, ...cityLineVia, CARDIFF_CENTRAL_CRS])

  const queenIndex = queenStreetVia.indexOf(otherCrs as (typeof queenStreetVia)[number])
  if (queenIndex >= 0) {
    const route = uniqueCrs([valleyCrs, ...queenStreetVia.slice(0, queenIndex + 1)])
    return {
      routes: originValley ? [route] : [route.slice().reverse()],
    }
  }

  const cityIndex = CITY_LINE_VIA_CRS.indexOf(otherCrs as (typeof CITY_LINE_VIA_CRS)[number])
  if (otherCrs === RADYR_CRS || cityIndex >= 0) {
    const via =
      otherCrs === RADYR_CRS ? [valleyCrs, RADYR_CRS] : uniqueCrs([valleyCrs, RADYR_CRS, ...CITY_LINE_VIA_CRS.slice(0, cityIndex + 1)])
    return {
      routes: originValley ? [via] : [via.slice().reverse()],
    }
  }

  const queenRoute =
    otherCrs === CARDIFF_CENTRAL_CRS
      ? towardsCentralQueen
      : uniqueCrs([...towardsCentralQueen, otherCrs])
  const cityRoute =
    otherCrs === CARDIFF_CENTRAL_CRS
      ? towardsCentralCity
      : uniqueCrs([...towardsCentralCity, otherCrs])

  return {
    routes: originValley ? [queenRoute, cityRoute] : [queenRoute.slice().reverse(), cityRoute.slice().reverse()],
  }
}
