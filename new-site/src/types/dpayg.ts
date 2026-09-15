/** D-PAYG scheme / fare models — keep in sync with iOS DPAYGSchemeModels.swift. */

export const DPAYG_SCHEMES_COLLECTION = 'dpayg_schemes'
export const DPAYG_FARES_COLLECTION = 'dpayg_fares'

export type DPAYGPricingModel = 'fixed_table' | 'dynamic'
export type DPAYGOperatorSelection = 'fixed' | 'single_choice'

export type DPAYGStation = {
  crs: string
  name: string
  /** PAYG fare zone when the catalogue provides one (TfW, London, Oyster). */
  zone?: string
  /** National Rail CRS when the matrix key is a Naptan / ATCO id. */
  displayCrs?: string
}

export type DPAYGCap = {
  dailyPence: number
  weeklyPence: number
  dailyLabel?: string
  weeklyLabel?: string
}

export type DPAYGOperatorOption = {
  name: string
}

export type DPAYGFareAmounts = {
  peakStandardPence: number
  peakRailcardEstPence: number
  offPeakStandardPence: number
  offPeakRailcardEstPence: number
}

export type DPAYGScheme = {
  id: string
  name: string
  shortName: string
  operatorBrand: string
  stnarea: string
  status: string
  pricingModel: DPAYGPricingModel
  sortOrder: number
  stations: DPAYGStation[]
  caps: DPAYGCap
  operators: DPAYGOperatorOption[]
  operatorSelection: DPAYGOperatorSelection
  defaultOperator: string
  railcardEstimates: boolean
  pricingNote?: string
}

export type DPAYGFare = {
  id: string
  schemeId: string
  originCrs: string
  destCrs: string
  originName: string
  destName: string
  fares: DPAYGFareAmounts
  /** False when the catalogue only publishes a single (not peak/off-peak). */
  hasOffPeak?: boolean
}

/** Firestore write payload for a scheme (no document id). */
export type DPAYGSchemeWritePayload = Omit<DPAYGScheme, 'id'>

/** Firestore write payload for a fare (no document id). */
export type DPAYGFareWritePayload = Omit<DPAYGFare, 'id'>

export function dpaygFareDocId(schemeId: string, originCrs: string, destCrs: string): string {
  return `${schemeId}_${originCrs.toUpperCase()}_${destCrs.toUpperCase()}`
}

export function formatDpaygPence(pence: number): string {
  const pounds = (Number.isFinite(pence) ? pence : 0) / 100
  return `£${pounds.toFixed(2)}`
}

/** Parse a £ display string (or plain number) into integer pence. */
export function parseDpaygPoundsToPence(value: string): number | null {
  const cleaned = value.replace(/[£,\s]/g, '').trim()
  if (cleaned === '') return null
  const pounds = Number.parseFloat(cleaned)
  if (!Number.isFinite(pounds)) return null
  return Math.round(pounds * 100)
}

export function penceToPoundsInput(pence: number): string {
  return ((Number.isFinite(pence) ? pence : 0) / 100).toFixed(2)
}
