/** Network Rail numeric TOC id (TRUST toc_id) → ATOC two-letter code. */
export const TRUST_TOC_ID = {
  20: "TP",
  22: "GW",
  23: "GR",
  24: "NT",
  25: "NT",
  27: "NT",
  28: "NT",
  29: "XC",
  30: "LO",
  34: "CC",
  35: "LE",
  36: "SE",
  37: "SN",
  43: "CH",
  48: "ME",
  50: "WR",
  51: "AW",
  54: "SW",
  55: "SW",
  56: "SR",
  60: "EM",
  61: "LM",
  64: "XR",
  65: "VT",
  71: "NT",
  74: "SE",
  79: "HX",
  80: "GX",
  81: "TL",
  82: "GN",
  83: "LN",
  84: "WM",
  86: "GC",
  88: "HT",
  91: "SR",
  93: "CS",
  94: "IL",
  97: "XR",
};

export function tocFromTrustId(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  const n = Number(s);
  if (Number.isFinite(n) && TRUST_TOC_ID[n]) return TRUST_TOC_ID[n];
  return null;
}

export function headcodeFromTrustTrainId(trainId) {
  const s = String(trainId || "");
  const slice = s.slice(2, 6);
  if (/^[0-9][A-Z][0-9]{2}$/i.test(slice)) return slice.toUpperCase();
  if (/^[0-9][A-Z][0-9]{2}$/i.test(s)) return s.toUpperCase();
  return null;
}
