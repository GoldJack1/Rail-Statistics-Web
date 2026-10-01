/** Human names for TIPLOCs when Darwin locname is missing or is the raw code. */

const SUFFIXES = [
  [/WESTJN$/, " West Junction"],
  [/EASTJN$/, " East Junction"],
  [/SOUTHJN$/, " South Junction"],
  [/NORTHJN$/, " North Junction"],
  [/WJ$/, " West Junction"],
  [/EJ$/, " East Junction"],
  [/SJ$/, " South Junction"],
  [/NJ$/, " North Junction"],
  [/DJN$/, " Junction"],
  [/UJN$/, " Junction"],
  [/JNCT$/, " Junction"],
  [/JCN$/, " Junction"],
  [/JN$/, " Junction"],
];

/** Stems Darwin never publishes as locnames. */
const PLACE_STEMS = {
  ARML: "Armley",
  APERLY: "Apperley",
  SHPYD: "Shipley",
  SHPY: "Shipley",
  MALTK: "Malton",
  SEAMW: "Seamer",
};

function titleCasePlace(s) {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      if (part === "junction") return "Junction";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

function firstPlaceWord(name) {
  return String(name)
    .replace(/\s+((West|East|South|North)\s+)?Junction$/i, "")
    .split(/[\s/&(]+/)[0];
}

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

function placeFromCatalog(rest, catalogHints) {
  const u = rest.toUpperCase();
  if (!u || !Array.isArray(catalogHints) || !catalogHints.length) return null;
  let best = null;
  for (const row of catalogHints) {
    const t = String(row.tiploc || "").toUpperCase();
    const name = String(row.name || "").trim();
    if (!t || !name || t === u || name.toUpperCase() === t) continue;
    const remainder = u.startsWith(t) ? u.slice(t.length) : t.startsWith(u) ? t.slice(u.length) : "";
    if (!remainder) continue;
    if (!/^(WJ|EJ|SJ|NJ|JN|JCN|DJN|UJN|J)$/.test(remainder) && remainder.length > 2) continue;
    let score = 0;
    if (u.startsWith(t) && t.length >= 4) score = t.length + 20;
    else if (t.startsWith(u) && u.length >= 5) score = u.length + 10;
    if (score && (!best || score > best.score)) best = { score, name };
  }
  return best ? firstPlaceWord(best.name) : null;
}

function placeFromStem(rest) {
  const u = rest.toUpperCase();
  if (PLACE_STEMS[u]) return PLACE_STEMS[u];
  let best = null;
  for (const [k, v] of Object.entries(PLACE_STEMS)) {
    if (u === k || (u.startsWith(k) && k.length >= 4)) {
      if (!best || k.length > best.len) best = { len: k.length, name: v };
    }
  }
  return best?.name || null;
}

export function formatTiplocName(tpl, officialName, catalogHints = []) {
  const key = String(tpl || "").trim().toUpperCase();
  const official = officialName && String(officialName).trim();
  if (official && official.toUpperCase() !== key) return official;
  if (official && official !== key) return official;
  if (!key) return null;
  let rest = key;
  let suffix = "";
  for (const [re, label] of SUFFIXES) {
    if (re.test(rest)) {
      suffix = label;
      rest = rest.replace(re, "");
      break;
    }
  }
  if (!suffix && /J$/.test(rest) && rest.length >= 6) {
    suffix = " Junction";
    rest = rest.slice(0, -1);
  }
  if (!rest) return suffix.trim() || key;
  const place =
    placeFromStem(rest) ||
    placeFromCatalog(rest, catalogHints) ||
    titleCasePlace(rest);
  return place + suffix;
}
