import type { DPAYGStation } from '@/types/dpayg'

/** Pack keys are 910G + TIPLOC; DFT NaPTAN uses 9100 + the same TIPLOC. */
type ExtraStation = {
  crs: string
  name: string
  displayCrs: string
}

/**
 * National Rail stops that are in the London & SE contactless area (PDF index
 * plus the 8 March 2026 Greater Anglia extension) but missing from the current
 * catalogue. Merged add-only — never updates or deletes existing rows.
 */
export const LONDON_SE_CONTACTLESS_EXTRAS: ExtraStation[] = [
  { crs: '910GBEULYPK', name: 'Beaulieu Park', displayCrs: 'BPA' },
  { crs: '910GBILERCY', name: 'Billericay Rail Station', displayCrs: 'BIC' },
  { crs: '910GBSHPSFD', name: "Bishop's Stortford Rail Station", displayCrs: 'BIS' },
  { crs: '910GCHLMSFD', name: 'Chelmsford Rail Station', displayCrs: 'CHM' },
  { crs: '910GHRLWMIL', name: 'Harlow Mill Rail Station', displayCrs: 'HWM' },
  { crs: '910GHRLWTWN', name: 'Harlow Town Rail Station', displayCrs: 'HWN' },
  { crs: '910GHFLPEVL', name: 'Hatfield Peverel Rail Station', displayCrs: 'HAP' },
  { crs: '910GHOCKLEY', name: 'Hockley Rail Station', displayCrs: 'HOC' },
  { crs: '910GINGTSTN', name: 'Ingatestone Rail Station', displayCrs: 'INT' },
  { crs: '910GPRITLWL', name: 'Prittlewell Rail Station', displayCrs: 'PRL' },
  { crs: '910GRAYLEGH', name: 'Rayleigh Rail Station', displayCrs: 'RLF' },
  { crs: '910GROCHFD', name: 'Rochford Rail Station', displayCrs: 'RFD' },
  { crs: '910GROYDON', name: 'Roydon Rail Station', displayCrs: 'RYN' },
  { crs: '910GSBDGWTH', name: 'Sawbridgeworth Rail Station', displayCrs: 'SAW' },
  { crs: '910GSTHVIC', name: 'Southend Victoria Rail Station', displayCrs: 'SOV' },
  { crs: '910GSTANAIR', name: 'Stansted Airport Rail Station', displayCrs: 'SSD' },
  { crs: '910GSTANMFC', name: 'Stansted Mountfitchet Rail Station', displayCrs: 'SST' },
  { crs: '910GWIKFORD', name: 'Wickford Rail Station', displayCrs: 'WIC' },
  { crs: '910GWITHAME', name: 'Witham Rail Station', displayCrs: 'WTM' },
  { crs: '910GSTHEAIR', name: 'Southend Airport Rail Station', displayCrs: 'SIA' },
  { crs: '910GHAMPTON', name: 'Hampton Rail Station', displayCrs: 'HMP' },
  { crs: '910GHRLG', name: 'Harlington (Bedfordshire) Rail Station', displayCrs: 'HLN' },
  { crs: '910GQTRDBAT', name: 'Queenstown Road Battersea Rail Station', displayCrs: 'QRB' },
  { crs: '910GSTJOHNS', name: 'St. Johns Rail Station', displayCrs: 'SAJ' },
  { crs: '910GSEERGRN', name: 'Seer Green & Jordans Rail Station', displayCrs: 'SRG' },
  { crs: '910GSUTTON', name: 'Sutton Rail Station', displayCrs: 'SUO' },
  { crs: '910GWOLWCHA', name: 'Woolwich Arsenal Rail Station', displayCrs: 'WWA' },
  { crs: '910GECROYDN', name: 'East Croydon Rail Station', displayCrs: 'ECR' },
  { crs: '910GBCKNHMJ', name: 'Beckenham Junction Rail Station', displayCrs: 'BKJ' },
  { crs: '910GELMERSE', name: 'Elmers End Rail Station', displayCrs: 'ELE' },
  { crs: '910GMITCHMJ', name: 'Mitcham Junction Rail Station', displayCrs: 'MIJ' },
  { crs: '910GBIRKBCK', name: 'Birkbeck Rail Station', displayCrs: 'BIK' },
  { crs: '910GUWRLNGH', name: 'Upper Warlingham Rail Station', displayCrs: 'UUW' },
  { crs: '910GWSORAER', name: 'Windsor & Eton Riverside Rail Station', displayCrs: 'WNR' },
]

function foldStationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[./(),+\-–—]/g, ' ')
    .replace(/\brail station\b/g, ' ')
    .replace(/\bstation\b/g, ' ')
    .replace(/\blondon\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTramDlrOrTube(station: DPAYGStation): boolean {
  const name = station.name.toLowerCase()
  return (
    name.includes('tram') ||
    name.includes('dlr') ||
    name.includes('underground') ||
    station.crs.toUpperCase().startsWith('940')
  )
}

function extraAlreadyPresent(existing: DPAYGStation[], extra: ExtraStation): boolean {
  const extraCrs = extra.crs.trim().toUpperCase()
  const extraDisplay = extra.displayCrs.trim().toUpperCase()
  const extraName = foldStationName(extra.name)
  return existing.some((station) => {
    if (station.crs.trim().toUpperCase() === extraCrs) return true
    if (isTramDlrOrTube(station)) return false
    const display = station.displayCrs?.trim().toUpperCase()
    if (display && display === extraDisplay) return true
    if (station.crs.trim().toUpperCase() === extraDisplay) return true
    return foldStationName(station.name) === extraName
  })
}

/** Adds missing London & SE stops. Never mutates or drops existing stations. */
export function addMissingLondonSeStations(stations: DPAYGStation[]): DPAYGStation[] {
  const next = [...stations]
  for (const extra of LONDON_SE_CONTACTLESS_EXTRAS) {
    if (extraAlreadyPresent(next, extra)) continue
    next.push({
      crs: extra.crs,
      name: extra.name,
      displayCrs: extra.displayCrs,
    })
  }
  next.sort((a, b) => a.name.localeCompare(b.name) || a.crs.localeCompare(b.crs))
  return next
}
