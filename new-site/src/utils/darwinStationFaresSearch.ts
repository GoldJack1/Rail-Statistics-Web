import type { Station } from '@/types'
import type { DPAYGStation } from '@/types/dpayg'
import { filterDpaygStations, matchDpaygStation, stationPublicCode } from '@/utils/dpaygStationSearch'

const SUGGESTION_LIMIT = 12

function toFaresSearchStation(station: Station): DPAYGStation {
  return {
    crs: (station.crsCode || station.tiploc || station.id).toUpperCase(),
    name: station.stationName,
    displayCrs: station.crsCode?.toUpperCase() || undefined,
    zone: station.tiploc?.toUpperCase() || undefined,
  }
}

export function filterStationsLikeFaresSearch(stations: Station[], query: string): Station[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const records = stations.map((station) => ({ station, payg: toFaresSearchStation(station) }))
  const ranked = filterDpaygStations(records.map((record) => record.payg), trimmed)
  return ranked.slice(0, SUGGESTION_LIMIT).map((payg) => {
    const match = records.find((record) => record.payg === payg)
    return match!.station
  })
}

export function matchStationLikeFaresSearch(stations: Station[], query: string): Station | null {
  const trimmed = query.trim()
  if (!trimmed) return null
  const records = stations.map((station) => ({ station, payg: toFaresSearchStation(station) }))
  const hit = matchDpaygStation(records.map((record) => record.payg), trimmed)
  if (!hit) return null
  return records.find((record) => record.payg === hit)?.station ?? null
}

export function stationFaresSuggestionCode(station: Station): string {
  return stationPublicCode(toFaresSearchStation(station), true)
}
