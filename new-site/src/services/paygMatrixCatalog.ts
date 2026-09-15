import type { DPAYGFare, DPAYGScheme } from '@/types/dpayg'
import type { OysterFareTypeDef, PaygMatrixAreaDef } from '@/types/paygMatrix'

export { parseMatrixDestination } from '@/services/paygMatrixParse'

export type PaygZoneCapBand = {
  id: string
  title: string
  minZone: number
  maxZone: number
  dailyCapPence: number
  weeklyCapPence: number
}

export type PaygMatrixFare = DPAYGFare & {
  dailyCapPence: number
  weeklyCapPence: number
  notes?: string
  originZone?: string
  destZone?: string
}

export type PaygMatrixArea = DPAYGScheme & {
  zoneCapBands: PaygZoneCapBand[]
  hideStationCodes?: boolean
  oysterFareTypes?: OysterFareTypeDef[]
  collectionId?: string
}

const emptySchemeCaps = { dailyPence: 0, weeklyPence: 0 }

export function paygAreaStub(def: PaygMatrixAreaDef): PaygMatrixArea {
  return {
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    operatorBrand: def.operatorBrand,
    stnarea: 'GBNR',
    status: 'live',
    pricingModel: 'fixed_table',
    sortOrder: 0,
    stations: [],
    caps: emptySchemeCaps,
    operators: [{ name: def.operatorBrand }],
    operatorSelection: 'fixed',
    defaultOperator: def.operatorBrand,
    railcardEstimates: false,
    zoneCapBands: [],
    hideStationCodes: def.hideStationCodes === true,
    oysterFareTypes: def.oysterFareTypes,
    collectionId: def.collectionId,
  }
}

export function listPaygMatrixAreas(defs: PaygMatrixAreaDef[]): PaygMatrixArea[] {
  return defs.map(paygAreaStub)
}

export async function hydratePaygMatrixArea(
  def: PaygMatrixAreaDef,
  collectionId?: string
): Promise<PaygMatrixArea> {
  const params = new URLSearchParams({ areaId: def.id })
  if (collectionId) params.set('collectionId', collectionId)
  const response = await fetch(`/api/payg-matrix/area?${params.toString()}`)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Failed to load ${def.shortName}`)
  }
  return (await response.json()) as PaygMatrixArea
}

export async function getPaygMatrixFare(
  def: PaygMatrixAreaDef,
  originCrs: string,
  destCrs: string,
  collectionId?: string
): Promise<PaygMatrixFare | null> {
  const params = new URLSearchParams({
    areaId: def.id,
    origin: originCrs,
    dest: destCrs,
  })
  if (collectionId) params.set('collectionId', collectionId)
  const response = await fetch(`/api/payg-matrix/fare?${params.toString()}`)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || 'Failed to load fare')
  }
  const body = (await response.json()) as { fare: PaygMatrixFare | null }
  return body.fare
}
