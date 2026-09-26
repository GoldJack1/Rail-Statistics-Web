import type { Station } from '@/types'

export type UpcomingStationOpeningStatus = 'confirmed' | 'expected' | 'unknown'

/** Authoring convenience: `Confirmed` and `confirmed` are both accepted. */
export type UpcomingStationOpeningStatusInput =
  | UpcomingStationOpeningStatus
  | 'Confirmed'
  | 'Expected'
  | 'Unknown'

export type FeaturedUpcomingStation = Station & {
  openingStatus: UpcomingStationOpeningStatus
}

/**
 * Temporary records for the homepage "expected to open" hero.
 *
 * Replace these with confirmed station data when it is available. When known, keep
 * `dateOpened` in dd/mm/yyyy format. Placeholder cards are deliberately non-interactive.
 *
 * Card display uses `toc` (operator line), `stationName`, and the location line built
 * from `borough`, `county`, and `country`.
 */
type UpcomingStationInput = {
  id: string
  stationName: string
  /** Use confirmed, expected, or unknown to control the card caption. */
  openingStatus: UpcomingStationOpeningStatusInput
  /**
   * Opening date in dd/mm/yyyy, or free text for approximate timings such as
   * `late 2027` or `Summer 2028`. Omit entirely when the status is unknown.
   */
  dateOpened?: string
  /** Operator line above the station name. */
  toc?: string
  country?: string
  county?: string | null
  borough?: string | null
}

function createPlaceholderStation({
  id,
  stationName,
  openingStatus,
  dateOpened,
  toc = 'Operator TBC',
  country = 'Location TBC',
  county = null,
  borough = null,
}: UpcomingStationInput): FeaturedUpcomingStation {
  return {
    id,
    stationName,
    crsCode: '',
    tiploc: null,
    latitude: 0,
    longitude: 0,
    country,
    county,
    borough,
    toc,
    stnarea: 'GBNR',
    sourceCollectionId: 'stations_gbnr',
    dateOpened,
    openingStatus: openingStatus.toLowerCase() as UpcomingStationOpeningStatus,
    yearlyPassengers: null,
  }
}

export const FEATURED_UPCOMING_STATIONS: FeaturedUpcomingStation[] = [
  createPlaceholderStation({
    id: 'upcoming-1',
    stationName: 'Butetown',
    openingStatus: 'Expected',
    toc: 'Transport for Wales',
    country: 'Wales',
    county: 'Cardiff',
    dateOpened: '13/12/2026',
  }),
  createPlaceholderStation({
    id: 'upcoming-2',
    stationName: 'Bristol Brabazon',
    openingStatus: 'Expected',
    toc: 'Great Western Railway',
    country: 'England',
    county: 'Bristol',
    dateOpened: 'LATE 2026/EARLY 2027',
  }),
  createPlaceholderStation({
    id: 'upcoming-3',
    stationName: 'Winslow',
    openingStatus: 'Expected',
    toc: 'Chiltern Railways',
    country: 'England',
    county: 'Buckinghamshire',
    dateOpened: '2026-2028',
  }),
  createPlaceholderStation({
    id: 'upcoming-4',
    stationName: 'White Rose',
    openingStatus: 'Expected',
    toc: 'Northern',
    country: 'England',
    county: 'West Yorkshire',
    dateOpened: '2027-2028',
  })
]
