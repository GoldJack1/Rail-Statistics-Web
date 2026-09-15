export type PaygMatrixFamily = 'contactless' | 'smartcard'

export type OysterFareTypeDef = {
  id: string
  label: string
  collectionId: string
}

export type PaygMatrixAreaDef = {
  id: string
  slug: string
  shortName: string
  name: string
  operatorBrand: string
  collectionId: string
  zoneCapsCollectionId?: string
  hideStationCodes?: boolean
  oysterFareTypes?: OysterFareTypeDef[]
}

export const CONTACTLESS_PAYG_AREAS: PaygMatrixAreaDef[] = [
  {
    id: 'tfw-north-wales',
    slug: 'tfw-north-wales',
    shortName: 'TFW North Wales',
    name: 'Transport for Wales North Wales contactless',
    operatorBrand: 'Transport for Wales',
    collectionId: 'contactless_TFW_northwales',
    zoneCapsCollectionId: 'contactless_TFW_northwales_zone_caps',
  },
  {
    id: 'tfw-south-wales',
    slug: 'tfw-south-wales',
    shortName: 'TFW South Wales',
    name: 'Transport for Wales South Wales contactless',
    operatorBrand: 'Transport for Wales',
    collectionId: 'contactless_TFW_southwales',
    zoneCapsCollectionId: 'contactless_TFW_southwales_zone_caps',
  },
  {
    id: 'london-south-east',
    slug: 'london-south-east',
    shortName: 'London & South East',
    name: 'London and South East contactless',
    operatorBrand: 'Transport for London',
    collectionId: 'contactless_LDN+SE',
    hideStationCodes: true,
  },
]

export const SMARTCARD_PAYG_AREAS: PaygMatrixAreaDef[] = [
  {
    id: 'gwr-cornwall',
    slug: 'gwr-cornwall',
    shortName: 'GWR Cornwall',
    name: 'Great Western Railway Cornwall PAYG',
    operatorBrand: 'Great Western Railway',
    collectionId: 'smartpayg_GWR_cornwall',
  },
  {
    id: 'gwr-bristol-western',
    slug: 'gwr-bristol-western',
    shortName: 'GWR Bristol/Western',
    name: 'Great Western Railway Bristol and Western PAYG',
    operatorBrand: 'Great Western Railway',
    collectionId: 'smartpayg_GWR_bristolwestern',
  },
  {
    id: 'oyster-1-9',
    slug: 'oyster-1-9',
    shortName: 'Oyster 1–9',
    name: 'Oyster PAYG zones 1–9',
    operatorBrand: 'Transport for London',
    collectionId: 'Oyster1-9_TFL_Adult',
    hideStationCodes: true,
    oysterFareTypes: [
      { id: 'adult', label: 'Adult', collectionId: 'Oyster1-9_TFL_Adult' },
      { id: 'age-5-10', label: '5–10', collectionId: 'Oyster1-9_TFL_Age5To10' },
      { id: 'age-11-15', label: '11–15', collectionId: 'Oyster1-9_TFL_Age11To15' },
      { id: 'age-16-18', label: '16–18', collectionId: 'Oyster1-9_TFL_Age16To18' },
      { id: 'student-18-plus', label: 'Student 18+', collectionId: 'Oyster1-9_TFL_Student18Plus' },
      { id: 'apprentice', label: 'Apprentice', collectionId: 'Oyster1-9_TFL_Apprentice' },
      { id: 'railcard', label: 'Railcard', collectionId: 'Oyster1-9_TFL_Railcard' },
      {
        id: 'disabled-persons-railcard',
        label: 'Disabled Persons Railcard',
        collectionId: 'Oyster1-9_TFL_DisabledPersonsRailcard',
      },
      { id: 'jobcentre-plus', label: 'Jobcentre Plus', collectionId: 'Oyster1-9_TFL_JobcentrePlus' },
    ],
  },
]

export function paygAreasForFamily(family: PaygMatrixFamily): PaygMatrixAreaDef[] {
  return family === 'contactless' ? CONTACTLESS_PAYG_AREAS : SMARTCARD_PAYG_AREAS
}

export function findPaygAreaDef(areaId: string): PaygMatrixAreaDef | undefined {
  return [...CONTACTLESS_PAYG_AREAS, ...SMARTCARD_PAYG_AREAS].find((area) => area.id === areaId)
}

export function isAllowedPaygCollectionId(collectionId: string): boolean {
  return [...CONTACTLESS_PAYG_AREAS, ...SMARTCARD_PAYG_AREAS].some((area) => {
    if (area.collectionId === collectionId) return true
    if (area.zoneCapsCollectionId === collectionId) return true
    return area.oysterFareTypes?.some((type) => type.collectionId === collectionId) === true
  })
}
