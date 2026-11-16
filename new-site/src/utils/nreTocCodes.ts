/**
 * NRE / ATOC two-letter TOC codes used in Knowledgebase fields such as TrainOperator.
 * Names align with `toc_operators` catalog entries where possible.
 * @see https://wiki.openraildata.com/index.php/TOC_Codes
 */
export const NRE_TOC_CODE_TO_NAME: Readonly<Record<string, string>> = {
  AW: 'Transport for Wales',
  CC: 'c2c',
  CH: 'Chiltern Railways',
  CS: 'Caledonian Sleeper',
  EM: 'East Midlands Railway',
  ES: 'Eurostar',
  GC: 'Grand Central',
  GN: 'Great Northern',
  GR: 'LNER',
  GW: 'Great Western Railway',
  GX: 'Gatwick Express',
  HT: 'Hull Trains',
  HX: 'Heathrow Express',
  IL: 'Island Line',
  LD: 'Lumo',
  LE: 'Greater Anglia',
  LN: 'London Northwestern Railway',
  LO: 'London Overground',
  LT: 'London Underground',
  ME: 'Merseyrail',
  NR: 'Network Rail',
  NT: 'Northern',
  SE: 'Southeastern',
  SJ: 'South Yorkshire Supertram',
  SN: 'Southern',
  SR: 'ScotRail',
  SW: 'South Western Railway',
  SX: 'Stansted Express',
  TL: 'Thameslink',
  TP: 'TransPennine Express',
  VT: 'Avanti West Coast',
  WM: 'West Midlands Railway',
  WR: 'West Coast Railway Company',
  XC: 'CrossCountry',
  XR: 'Elizabeth line',
}

/** Resolve a two-letter NRE TOC code to a display name, or null when unknown. */
export function lookupNreTocCodeName(code: string): string | null {
  const trimmed = code.trim()
  if (!trimmed) return null
  return NRE_TOC_CODE_TO_NAME[trimmed.toUpperCase()] ?? null
}
