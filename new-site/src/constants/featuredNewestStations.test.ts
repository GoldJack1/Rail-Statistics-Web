import { describe, expect, it } from 'vitest'
import {
  FEATURED_NEWEST_MAINLINE_STATION,
  FEATURED_NEWEST_TRAM_STOP,
} from './featuredNewestStations'
import { NEW_STATION_NOTIFICATION_COLLECTION_IDS } from './stationCollections'
import { formatStationLocationDisplay } from '@/utils/formatStationLocation'
import { formatLightRailOpenedOnLabel } from '@/utils/lightRailOpenedOnLabel'
import { buildStationPath } from '@/utils/stationAreaSlug'
import { isLightRailStop } from '@/utils/stationCardForNetwork'

describe('featured newest mainline station', () => {
  it('belongs to a mainline network so it renders as a station card', () => {
    expect(NEW_STATION_NOTIFICATION_COLLECTION_IDS).toContain(
      FEATURED_NEWEST_MAINLINE_STATION.sourceCollectionId
    )
    expect(isLightRailStop(FEATURED_NEWEST_MAINLINE_STATION)).toBe(false)
  })

  it('links to its station detail page', () => {
    expect(buildStationPath(FEATURED_NEWEST_MAINLINE_STATION)).toBe(
      'gb-national-rail/balgray'
    )
  })

  it('has the locale fields the card location line needs', () => {
    expect(formatStationLocationDisplay(FEATURED_NEWEST_MAINLINE_STATION)).toBe(
      'East Renfrewshire, Scotland'
    )
  })

  it('has an operator to show above the station name', () => {
    expect(FEATURED_NEWEST_MAINLINE_STATION.toc).toBeTruthy()
  })
})

describe('featured newest tram stop', () => {
  it('is detected as light rail so it renders as a tram stop card', () => {
    expect(isLightRailStop(FEATURED_NEWEST_TRAM_STOP)).toBe(true)
  })

  it('links to its stop detail page', () => {
    expect(buildStationPath(FEATURED_NEWEST_TRAM_STOP)).toBe('south-yorkshire-supertram/magna')
  })

  it('has the locale fields the card location line needs', () => {
    expect(formatStationLocationDisplay(FEATURED_NEWEST_TRAM_STOP)).toBe(
      'Templeborough, South Yorkshire, England'
    )
  })

  it('has a parseable opening date for the opened-on label', () => {
    expect(formatLightRailOpenedOnLabel(FEATURED_NEWEST_TRAM_STOP)).toBe('Opened on 9 April 2026')
  })

  it('has lines served so the line strip renders', () => {
    expect(FEATURED_NEWEST_TRAM_STOP.linesServed).toBeTruthy()
  })
})
