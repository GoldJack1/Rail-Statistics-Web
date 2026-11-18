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
  LS: "Locomotive Services",
  LO: "London Overground",
  LT: "London Underground",
  ME: "Merseyrail",
  NR: "Network Rail",
  NT: "Northern",
  SE: "Southeastern",
  SJ: "South Yorkshire Supertram",
  SN: "Southern",
  SR: "ScotRail",
  SW: "South Western Railway",
  SX: "Stansted Express",
  TL: "Thameslink",
  TP: "TransPennine Express",
  TW: "Tyne and Wear Metro",
  VT: "Avanti West Coast",
  WM: "West Midlands Railway",
  WR: "West Coast Railway Company",
  XC: "CrossCountry",
  XR: "Elizabeth line",
  ZZ: "Charter / other operator",
};

// "LM" is shared by London Northwestern Railway and West Midlands Railway; the ends of the run say which.
const LNWR_CRS = new Set(["EUS", "MKC", "NMP", "BDM", "BLY", "WFJ", "TRI", "LIV", "CRE", "RUG", "COV", "BHI", "LET", "HML", "LBZ", "TAM"]);
const WMR_CRS = new Set([
  "BSW", "SAD", "WSL", "LYE", "STO", "UNI", "RDD", "FOK", "BMO", "KNN", "DDP", "HFD", "WOF", "WOS", "KID", "GMV", "SAV",
  "SHR", "LIF", "RDC", "BMV", "SBJ", "SBT", "LMS", "WVH", "CNK",
]);

/** LNWR or WMR for an "LM" service from its origin and destination CRS; WMR when neither end settles it. */
export function lmOperatorName(originCrs, destCrs) {
  const ends = [originCrs, destCrs].map((c) => String(c || "").toUpperCase());
  if (ends.some((c) => LNWR_CRS.has(c))) return TOC_NAMES.LN;
  return TOC_NAMES.WM;
}

export function tocDisplayName(code, { originCrs = null, destCrs = null } = {}) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (c === "LM") return lmOperatorName(originCrs, destCrs);
  if (c.length === 2 && TOC_NAMES[c]) return TOC_NAMES[c];
  return String(code).trim() || null;
}
