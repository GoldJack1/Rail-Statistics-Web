/**
 * Unwrap RDM Kafka PTAC envelopes and parse S506 consist XML.
 */
import { consistJoinKey, parseConsistMessage } from "./consist-parser.js";

export function parseCore(core) {
  const s = String(core || "").trim();
  const m = s.match(/^([0-9][A-Za-z][0-9]{2})([A-Za-z][0-9]{5})/);
  if (!m) return { headcode: null, uid: null };
  return { headcode: m[1].toUpperCase(), uid: m[2].toUpperCase() };
}

function extractXml(payload) {
  if (typeof payload === "string" && payload.includes("<PassengerTrainConsistMessage")) return payload;
  if (!payload || typeof payload !== "object") return "";
  const bytes = payload.bytes;
  if (typeof bytes === "string" && bytes.includes("<PassengerTrainConsistMessage")) return bytes;
  if (typeof payload.xml === "string" && payload.xml.includes("<PassengerTrainConsistMessage")) return payload.xml;
  if (typeof payload.text === "string" && payload.text.includes("<PassengerTrainConsistMessage")) return payload.text;
  return "";
}

function fromConsist(consist) {
  const join = consistJoinKey(consist);
  const unitIds = [];
  for (const alloc of consist.allocations || []) {
    for (const group of alloc.resourceGroups || []) {
      const id = String(group.unitId || "").trim();
      if (/^\d{3,8}$/.test(id)) unitIds.push(id);
    }
  }
  const coreParsed = parseCore(consist.core);
  const originTpl = join?.originTpl || consist.allocations?.[0]?.trainOrigin?.tiploc || null;
  const originHHMM = join?.originHHMM || (consist.allocations?.[0]?.trainOriginDateTime || "").slice(11, 16) || null;
  return {
    unitIds: [...new Set(unitIds)],
    rid: null,
    uid: coreParsed.uid,
    headcode: consist.headcode || coreParsed.headcode,
    core: consist.core || null,
    operatingDay: consist.startDate || consist.allocations?.[0]?.diagramDate || join?.ssd || null,
    originTpl,
    originHHMM: originHHMM || null,
    json: consist,
    consist,
  };
}

export function parsePtacMessage(payload) {
  const xml = extractXml(payload);
  if (xml) {
    const consist = parseConsistMessage(xml);
    if (consist) return fromConsist(consist);
  }
  return {
    unitIds: [],
    rid: null,
    uid: null,
    headcode: null,
    core: null,
    operatingDay: null,
    originTpl: null,
    originHHMM: null,
    json: payload && typeof payload === "object" ? payload : null,
    consist: null,
  };
}
