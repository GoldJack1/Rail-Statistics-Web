/**
 * LINX BPLAN Reference & Geography extract (flow S529.001).
 * Records are tab-separated. Layout follows LINX BPLAN Extract Files
 * RDM-S529.001: PIF, REF, TLD, LOC, PLT, NWK, TLK, PIT.
 * Geography dates may be blank. OS grid on LOC is published as approximate.
 */

const RECORD_WIDTH = {
  PIF: 10,
  REF: 5,
  TLD: 10,
  LOC: 13,
  PLT: 10,
  NWK: 19,
  TLK: 15,
  PIT: 25,
};

function cell(parts, index) {
  const value = parts[index] == null ? "" : String(parts[index]).trim();
  return value || null;
}

/** dd-mm-yyyy hh:mm:ss, or blank. */
export function parseBplanDate(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = "00", min = "00", ss = "00"] = m;
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

/** Sectional running time `+05'30` or `005'30` → seconds. Negative if signed minus. */
export function parseSectionalRunningTime(value) {
  const s = String(value || "").trim();
  const m = /^([+-])?(\d+)'(\d{2})$/.exec(s);
  if (!m) return null;
  const seconds = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -seconds : seconds;
}

function parseIntCell(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

function parsePif(parts) {
  return {
    type: "PIF",
    specVersion: cell(parts, 1),
    source: cell(parts, 2),
    owner: cell(parts, 3),
    timetableStart: parseBplanDate(parts[4]),
    timetableEnd: parseBplanDate(parts[5]),
    cycleType: cell(parts, 6),
    cycleStage: cell(parts, 7),
    createdAt: parseBplanDate(parts[8]),
    sequence: parseIntCell(cell(parts, 9)),
  };
}

function parseRef(parts) {
  return {
    type: "REF",
    action: cell(parts, 1),
    subtype: cell(parts, 2),
    code: cell(parts, 3),
    description: cell(parts, 4),
  };
}

function parseTld(parts) {
  return {
    type: "TLD",
    action: cell(parts, 1),
    traction: cell(parts, 2),
    trailingLoad: cell(parts, 3),
    speed: parseIntCell(cell(parts, 4)),
    raGauge: cell(parts, 5),
    description: cell(parts, 6),
    itpsPower: cell(parts, 7),
    itpsTimingLoad: cell(parts, 8),
    itpsLimitingSpeed: parseIntCell(cell(parts, 9)),
  };
}

function parseLoc(parts) {
  return {
    type: "LOC",
    action: cell(parts, 1),
    tiploc: cell(parts, 2),
    name: cell(parts, 3),
    start: parseBplanDate(parts[4]),
    end: parseBplanDate(parts[5]),
    easting: parseIntCell(cell(parts, 6)),
    northing: parseIntCell(cell(parts, 7)),
    timingPointType: cell(parts, 8),
    zone: cell(parts, 9),
    stanox: cell(parts, 10),
    offNetwork: cell(parts, 11),
    forceLbp: cell(parts, 12),
  };
}

function parsePlt(parts) {
  return {
    type: "PLT",
    action: cell(parts, 1),
    tiploc: cell(parts, 2),
    platform: cell(parts, 3),
    start: parseBplanDate(parts[4]),
    end: parseBplanDate(parts[5]),
    lengthM: parseIntCell(cell(parts, 6)),
    power: cell(parts, 7),
    dooPassenger: cell(parts, 8),
    dooNonPassenger: cell(parts, 9),
  };
}

function parseNwk(parts) {
  return {
    type: "NWK",
    action: cell(parts, 1),
    fromTiploc: cell(parts, 2),
    toTiploc: cell(parts, 3),
    line: cell(parts, 4),
    lineDescription: cell(parts, 5),
    start: parseBplanDate(parts[6]),
    end: parseBplanDate(parts[7]),
    initialDirection: cell(parts, 8),
    finalDirection: cell(parts, 9),
    distanceM: parseIntCell(cell(parts, 10)),
    dooPassenger: cell(parts, 11),
    dooNonPassenger: cell(parts, 12),
    retb: cell(parts, 13),
    zone: cell(parts, 14),
    reversible: cell(parts, 15),
    power: cell(parts, 16),
    routeAvailability: cell(parts, 17),
    maxTrainLength: parseIntCell(cell(parts, 18)),
  };
}

function parseTlk(parts) {
  return {
    type: "TLK",
    action: cell(parts, 1),
    fromTiploc: cell(parts, 2),
    toTiploc: cell(parts, 3),
    line: cell(parts, 4),
    traction: cell(parts, 5),
    trailingLoad: cell(parts, 6),
    speed: parseIntCell(cell(parts, 7)),
    raGauge: cell(parts, 8),
    entrySpeed: parseIntCell(cell(parts, 9)),
    exitSpeed: parseIntCell(cell(parts, 10)),
    start: parseBplanDate(parts[11]),
    end: parseBplanDate(parts[12]),
    runningSeconds: parseSectionalRunningTime(parts[13]),
    description: cell(parts, 14),
  };
}

function parsePit(parts) {
  const counts = {};
  for (let i = 1; i + 3 < parts.length; i += 4) {
    const name = cell(parts, i);
    if (!name) continue;
    counts[name] = parseIntCell(cell(parts, i + 1)) || 0;
  }
  return { type: "PIT", counts };
}

const PARSERS = {
  PIF: parsePif,
  REF: parseRef,
  TLD: parseTld,
  LOC: parseLoc,
  PLT: parsePlt,
  NWK: parseNwk,
  TLK: parseTlk,
  PIT: parsePit,
};

/** One physical line. Returns null for a blank line. Throws if the width is wrong. */
export function parseBplanRecord(line) {
  const text = String(line || "").replace(/\r$/, "");
  if (!text.trim()) return null;
  const parts = text.split("\t");
  const type = parts[0];
  const width = RECORD_WIDTH[type];
  if (!width) throw new Error(`unknown BPLAN record type ${type}`);
  if (parts.length !== width) {
    throw new Error(`${type} has ${parts.length} fields, expected ${width}`);
  }
  return PARSERS[type](parts);
}

/**
 * Walk a full extract. The PIT trailer must match the records seen.
 * @returns {{ header: object|null, counts: Record<string, number>, trailer: object|null }}
 */
export function auditBplanExtract(text) {
  const counts = {};
  let header = null;
  let trailer = null;
  for (const line of String(text).split(/\n/)) {
    const row = parseBplanRecord(line);
    if (!row) continue;
    if (row.type === "PIF") header = row;
    else if (row.type === "PIT") trailer = row;
    else counts[row.type] = (counts[row.type] || 0) + 1;
  }
  if (trailer) {
    for (const [type, count] of Object.entries(trailer.counts)) {
      if ((counts[type] || 0) !== count) {
        throw new Error(`PIT ${type} says ${count}, file has ${counts[type] || 0}`);
      }
    }
  }
  return { header, counts, trailer };
}
