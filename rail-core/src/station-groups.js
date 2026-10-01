/**
 * One physical station published under two CRS codes (National Rail + Elizabeth line).
 * The first code is the one boards and search should prefer.
 */
export const STATION_CRS_GROUPS = [
  ["ZFD", "FDX"],
  ["ZLW", "WHX"],
  ["ABW", "ABX"],
  ["LST", "LSX"],
  ["PAD", "PDX"],
  ["GLC", "GCL"],
  ["GLQ", "GQL"],
  ["HHL", "HLL"],
  ["LIF", "LTV"],
  ["LIV", "LVL"],
  ["ALE", "LPY"],
  ["RET", "XRO"],
  ["SGB", "XGQ"],
  ["TAH", "TAM"],
  ["WPH", "WOP"],
  ["CNN", "XIC"],
  ["MRF", "XMR"],
  ["HHY", "HII", "XHZ"],
  ["UPM", "XUP"],
  ["STP", "SPX", "SPL"],
  ["RDG", "RDZ"],
];

export function stationCrsGroup(code) {
  const c = String(code || "").toUpperCase();
  if (!c) return null;
  return STATION_CRS_GROUPS.find((group) => group.includes(c)) || null;
}

/** Tiplocs for every CRS that belongs to the same station as `code`. */
export function tiplocsForStation(code, tiplocsByCrs) {
  const requested = String(code || "").toUpperCase();
  const group = stationCrsGroup(requested) || [requested];
  const out = new Set();
  for (const crs of group) {
    for (const tiploc of tiplocsByCrs(crs) || []) {
      const tpl = String(tiploc || "").toUpperCase();
      if (tpl) out.add(tpl);
    }
  }
  return { crs: requested, group, tiplocs: [...out] };
}
