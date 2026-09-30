/** NRE two-letter TOC codes → display names */
export const TOC_NAMES = {
  AW: "Transport for Wales",
  CC: "c2c",
  CH: "Chiltern Railways",
  CS: "Caledonian Sleeper",
  EM: "East Midlands Railway",
  ES: "Eurostar",
  GC: "Grand Central",
  GN: "Great Northern",
  GR: "LNER",
  GW: "Great Western Railway",
  GX: "Gatwick Express",
  HT: "Hull Trains",
  HX: "Heathrow Express",
  IL: "Island Line",
  LD: "Lumo",
  LE: "Greater Anglia",
  LN: "London Northwestern Railway",
  LO: "London Overground",
  LT: "London Underground",
  ME: "Merseyrail",
  NR: "Network Rail",
  NT: "Northern",
  SE: "Southeastern",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  SX: "Stansted Express",
  TL: "Thameslink",
  TP: "TransPennine Express",
  VT: "Avanti West Coast",
  WM: "West Midlands Railway",
  WR: "West Coast Railway Company",
  XC: "CrossCountry",
  XR: "Elizabeth line",
};

export function tocDisplayName(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (c.length === 2 && TOC_NAMES[c]) return TOC_NAMES[c];
  return String(code).trim() || null;
}
