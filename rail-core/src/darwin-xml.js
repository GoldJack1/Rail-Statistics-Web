import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { adoptUidOntoRid, hhmm, liveKind, openCatalog, openDayDb, operatingDayYmd, platformText, upsertCall, upsertService } from "./db.js";
import { extractDarwinAssociationsJson, extractDarwinAssociationsXml, upsertAssociation } from "./associations.js";
import { publicJourneyEnds } from "./journey-order.js";

function text(el) {
  if (!el) return "";
  return String(el).trim();
}

function coachFromAttrs(attrs) {
  const number = attrs.match(/\bcoachNumber="([^"]+)"/i)?.[1];
  if (!number) return null;
  return {
    number,
    class: attrs.match(/\bcoachClass="([^"]+)"/i)?.[1] || "Standard",
    toilet: attrs.match(/\btoilet="([^"]+)"/i)?.[1] || null,
    catering: attrs.match(/\bcatering="([^"]+)"/i)?.[1] || null,
  };
}

/** Darwin TS `<formation><coa/></formation>` passenger coach diagram. */
export function parseFormationXml(xml) {
  const block = String(xml || "").match(/<(?:[\w-]+:)?formation\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?formation>/i);
  if (!block) return null;
  const fid = block[1].match(/\bfid="([^"]+)"/i)?.[1] || "";
  const coaches = [];
  const coa = /<(?:[\w-]+:)?coa\b([^>]*?)\/?>/gi;
  let m;
  while ((m = coa.exec(block[2]))) {
    const coach = coachFromAttrs(m[1]);
    if (coach) coaches.push(coach);
  }
  return coaches.length ? JSON.stringify({ fid, coaches }) : null;
}

function finiteNumber(raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Darwin location loading: overall 0–100 and per-coach grades. */
export function parseLoadingXml(attrs, inner) {
  const blob = `${attrs || ""} ${inner || ""}`;
  const pct = finiteNumber(
    blob.match(/\bloadingPercentage="([^"]+)"/i)?.[1] ||
      blob.match(/<(?:[\w-]+:)?loadingPercentage[^>]*>([^<]+)/i)?.[1],
  );
  const coaches = [];
  const re = /<(?:[\w-]+:)?formationLoading\b([^>]*?)\/?>/gi;
  let m;
  while ((m = re.exec(blob))) {
    const number = m[1].match(/\bcoachNumber="([^"]+)"/i)?.[1];
    const value = finiteNumber(m[1].match(/\bloading="([^"]+)"/i)?.[1]);
    if (number && value != null) coaches.push({ number, value });
  }
  return {
    loading_percentage: pct,
    coach_loading: coaches.length ? JSON.stringify(coaches) : null,
  };
}

function parseLoadingJson(loc, pick, getCI) {
  const loadingNode = getCI(loc, "loading");
  const pct = finiteNumber(
    pick(loc, "loadingPercentage") ||
      (loadingNode && typeof loadingNode === "object" ? pick(loadingNode, "loadingPercentage") : null),
  );
  const raw = getCI(loc, "formationLoading") || (loadingNode && typeof loadingNode === "object" ? getCI(loadingNode, "formationLoading") : null);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const coaches = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const number = pick(item, "coachNumber") || pick(item, "number");
    const value = finiteNumber(pick(item, "loading") || pick(item, "value"));
    if (number && value != null) coaches.push({ number: String(number), value });
  }
  return {
    loading_percentage: pct,
    coach_loading: coaches.length ? JSON.stringify(coaches) : null,
  };
}

function parseFormationJson(ts, getCI, pick) {
  const node = getCI(ts, "formation");
  if (!node || typeof node !== "object") return null;
  const fid = String(pick(node, "fid") || "");
  const raw = getCI(node, "coa") || getCI(node, "coach") || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const coaches = [];
  for (const coach of list) {
    if (!coach || typeof coach !== "object") continue;
    const number = pick(coach, "coachNumber") || pick(coach, "number");
    if (!number) continue;
    coaches.push({
      number: String(number),
      class: String(pick(coach, "coachClass") || pick(coach, "class") || "Standard"),
      toilet: pick(coach, "toilet") ? String(pick(coach, "toilet")) : null,
      catering: pick(coach, "catering") ? String(pick(coach, "catering")) : null,
    });
  }
  return coaches.length ? JSON.stringify({ fid, coaches }) : null;
}

/** Minimal Darwin PPort XML: extract TS and schedule-like attributes from a raw string. */
export function parseDarwinPportXml(xml) {
  const associationsEarly = extractDarwinAssociationsXml(xml);
  const rid = xml.match(/\brid="([^"]+)"/)?.[1];
  if (!rid) {
    return associationsEarly.length
      ? { service: null, calls: [], associations: associationsEarly, fullJourney: false }
      : null;
  }
  const uid = xml.match(/\buid="([^"]+)"/)?.[1] ?? null;
  const toc = normalizeToc(xml.match(/\btoc="([^"]+)"/)?.[1]);
  const trainId = xml.match(/\btrainId="([^"]+)"/)?.[1] ?? null;
  const fullJourney = /<(?:ns\d*:)?(?:OR|DT)\b/i.test(xml);
  const isCancel = /<ns\d*:cancel|<cancel[\s>]/i.test(xml) ? 1 : 0;

  const locations = [];
  const locRe =
    /<(?:ns\d*:)?(OR|OPOR|IP|OPIP|PP|DT|OPDT)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:ns\d*:)?(?:OR|OPOR|IP|OPIP|PP|DT|OPDT)>)/gi;
  let m;
  let seq = 0;
  while ((m = locRe.exec(xml))) {
    const tag = (m[1] || "").toUpperCase();
    const attrs = m[2];
    const inner = m[3] || "";
    const isPassing = tag === "PP" || tag.includes("PP") ? 1 : 0;
    const tpl = attrs.match(/\btpl="([^"]+)"/)?.[1] ?? "";
    const crs = attrs.match(/\bcrs="([^"]+)"/)?.[1] ?? null;
    const plat =
      attrs.match(/\bplat(?:form)?="([^"]+)"/)?.[1] ??
      inner.match(/\bplat(?:form)?="([^"]+)"/)?.[1] ??
      inner.match(/<(?:ns\d*:)?plat[^>]*>([^<]+)/i)?.[1];
    const pick = (name) =>
      attrs.match(new RegExp(`${name}="([^"]+)"`))?.[1] ??
      inner.match(new RegExp(`${name}="([^"]+)"`))?.[1] ??
      inner.match(new RegExp(`<(?:ns\\d*:)?${name}[^>]*>([^<]+)`, "i"))?.[1];
    const ata = hhmm(pick("ata"));
    const atd = hhmm(pick("atd"));
    const atp = hhmm(pick("atp") || pick("pass"));
    const eta = hhmm(pick("eta"));
    const etd = hhmm(pick("etd"));
    const etp = hhmm(pick("etp"));
    let sta = hhmm(pick("pta") || pick("sta"));
    let std = hhmm(pick("ptd") || pick("std"));
    if (isPassing && sta === "00:00") sta = null;
    if (isPassing && std === "00:00") std = null;
    const wta = hhmm(pick("wta"));
    const wtd = hhmm(pick("wtd"));
    const wtp = hhmm(pick("wtp"));
    const loading = parseLoadingXml(attrs, inner);
    locations.push({
      rid,
      tiploc: tpl,
      crs,
      seq: seq++,
      is_passing: isPassing,
      cancelled: 0,
      platform: platformText(plat),
      length_cars: null,
      formation: null,
      loading_percentage: loading.loading_percentage,
      coach_loading: loading.coach_loading,
      sta,
      std,
      wta,
      wtd,
      wtp,
      ata,
      atd,
      atp: atp || (isPassing ? hhmm(pick("pass")) : null),
      eta,
      etd,
      etp,
      delay_minutes: null,
      status: null,
      live_kind: liveKind({ ata, atd, atp, eta, etd, etp }),
      actual_source: ata || atd || atp ? "darwin" : null,
      updated_at: Date.now(),
    });
  }
  const formation = parseFormationXml(xml);
  const associations = extractDarwinAssociationsXml(xml);
  if (!locations.length) {
    if (!formation) return null;
    return {
      service: {
        rid,
        uid,
        train_id: trainId,
        rs_id: null,
        toc,
        operator_name: toc,
        origin_crs: null,
        origin_name: null,
        destination_crs: null,
        destination_name: null,
        via: null,
        service_type: "passenger",
        cancelled: isCancel,
        cancel_reason: null,
        delay_reason: null,
        is_charter: 0,
        category: null,
        headcode: trainId,
        formation,
        updated_at: Date.now(),
      },
      calls: [],
      fullJourney: false,
      associations,
    };
  }
  const calls = mergeCallsByTiploc(locations);
  const { origin, dest } = publicJourneyEnds(calls);
  return {
    service: {
      rid,
      uid,
      train_id: trainId,
      rs_id: null,
      toc,
      operator_name: toc,
      origin_crs: origin?.crs ?? null,
      origin_name: null,
      destination_crs: dest?.crs ?? null,
      destination_name: null,
      via: null,
      service_type: "passenger",
      cancelled: isCancel,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: null,
      headcode: trainId,
      formation,
      updated_at: Date.now(),
    },
    calls,
    fullJourney,
    associations,
  };
}

function flatten(node) {
  if (Array.isArray(node)) return node.map(flatten);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    let key = k.startsWith("@") ? k.slice(1) : k;
    if (key.includes(":")) key = key.split(":").pop();
    if (key === "$" && v && typeof v === "object") {
      Object.assign(out, flatten(v));
      continue;
    }
    out[key] = flatten(v);
  }
  return out;
}

function pick(loc, k) {
  if (!loc || typeof loc !== "object") return null;
  const v =
    loc[k] ??
    loc[k.toLowerCase()] ??
    loc[`@${k}`] ??
    loc[`@${k.toLowerCase()}`];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if ("#text" in v) return v["#text"];
    if ("_" in v) return v._;
    if ("text" in v) return v.text;
    if ("value" in v) return v.value;
    if ("$text" in v) return v.$text;
  }
  return v ?? null;
}

function hasOwnField(loc, k) {
  if (!loc || typeof loc !== "object") return false;
  const want = k.toLowerCase();
  return Object.keys(loc).some((key) => key.toLowerCase() === want);
}

function scalar(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object") {
    const inner = platformText(v);
    if (inner) return inner;
    return pick(v, "#text") || pick(v, "text") || null;
  }
  const s = String(v);
  return s === "[object Object]" ? null : v;
}

function mergeCallsByTiploc(locations) {
  const map = new Map();
  for (const loc of locations) {
    const key = loc.tiploc;
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...loc });
      continue;
    }
    const merged = { ...prev };
    for (const [k, v] of Object.entries(loc)) {
      if (v != null && v !== "" && v !== "[object Object]") merged[k] = v;
    }
    merged.seq = Math.min(prev.seq, loc.seq);
    if (merged.sta || merged.std) merged.is_passing = 0;
    map.set(key, merged);
  }
  return [...map.values()].sort((a, b) => a.seq - b.seq);
}

function normalizeToc(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  return null;
}

function ridAttrsFromNode(node) {
  return {
    toc: normalizeToc(scalar(pick(node, "toc")) || scalar(pick(node, "atocCode")) || scalar(pick(node, "atoc"))),
    uid: scalar(pick(node, "uid")),
    trainId: scalar(pick(node, "trainId")) || scalar(pick(node, "trainID")),
  };
}

function getCI(obj, name) {
  if (!obj || typeof obj !== "object") return undefined;
  if (obj[name] != null) return obj[name];
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function eventTimes(node, kind) {
  const ev = getCI(node, kind);
  if (ev == null || ev === "") return { at: null, et: null };
  if (typeof ev !== "object") return { at: hhmm(ev), et: null };
  return {
    at: hhmm(pick(ev, "at") || pick(ev, "aat") || pick(ev, "actual")),
    et: hhmm(pick(ev, "et") || pick(ev, "wet") || pick(ev, "estimated")),
  };
}

export function parseDarwinPportJson(obj) {
  if (!obj || typeof obj !== "object") return null;
  const flat = flatten(obj);
  const hits = [];
  const walk = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      if (Array.isArray(node)) node.forEach(walk);
      return;
    }
    const rid = pick(node, "rid");
    const hasLoc =
      getCI(node, "Location") ||
      getCI(node, "TSLocation") ||
      getCI(node, "locations") ||
      getCI(node, "OR") ||
      getCI(node, "IP") ||
      getCI(node, "PP") ||
      getCI(node, "DT") ||
      getCI(node, "OPDT") ||
      getCI(node, "OPIP");
    if (rid && hasLoc) hits.push(node);
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(flat);
  const ts = hits[0];
  if (!ts) return null;
  const rid = String(pick(ts, "rid"));
  const extra = ridAttrsFromNode(ts);
  const uid = extra.uid || pick(ts, "uid") || null;
  const toc = extra.toc || normalizeToc(pick(ts, "toc"));
  const trainId = extra.trainId || pick(ts, "trainId") || null;
  const fullJourney = Boolean(getCI(ts, "OR") || getCI(ts, "DT") || getCI(ts, "schedule"));
  const buckets = [];
  const pushLoc = (item, passing) => {
    if (!item) return;
    for (const loc of Array.isArray(item) ? item : [item]) buckets.push({ loc, passing });
  };
  const locationList =
    getCI(ts, "Location") || getCI(ts, "TSLocation") || getCI(ts, "locations");
  if (locationList) {
    pushLoc(locationList, false);
  } else {
    for (const [k, v] of Object.entries(ts)) {
      const u = k.toUpperCase();
      if (!["OR", "OPOR", "IP", "OPIP", "PP", "DT", "OPDT"].includes(u)) continue;
      pushLoc(v, u === "PP" || u === "OPIP");
    }
  }
  const locations = [];
  let seq = 0;
  for (const { loc, passing } of buckets) {
    if (!loc || typeof loc !== "object") continue;
    const tpl = pick(loc, "tpl") || "";
    const crs = pick(loc, "crs");
    const platRaw = scalar(pick(loc, "plat") || pick(loc, "platform"));
    const plat = platformText(platRaw);
    const ownPta = hasOwnField(loc, "pta") || hasOwnField(loc, "sta");
    const ownPtd = hasOwnField(loc, "ptd") || hasOwnField(loc, "std");
    const arrT = eventTimes(loc, "arr");
    const depT = eventTimes(loc, "dep");
    const passT = eventTimes(loc, "pass");
    const ata = hhmm(pick(loc, "ata")) || arrT.at;
    const atd = hhmm(pick(loc, "atd")) || depT.at;
    const atp = hhmm(pick(loc, "atp") || pick(loc, "pass")) || passT.at;
    const eta = hhmm(pick(loc, "eta")) || arrT.et;
    const etd = hhmm(pick(loc, "etd")) || depT.et;
    const etp = hhmm(pick(loc, "etp")) || passT.et;
    let sta = ownPta ? hhmm(pick(loc, "pta") || pick(loc, "sta")) : null;
    let std = ownPtd ? hhmm(pick(loc, "ptd") || pick(loc, "std")) : null;
    const wta = hasOwnField(loc, "wta") ? hhmm(pick(loc, "wta")) : null;
    const wtd = hasOwnField(loc, "wtd") ? hhmm(pick(loc, "wtd")) : null;
    const wtp = hasOwnField(loc, "wtp") ? hhmm(pick(loc, "wtp")) : null;
    const loading = parseLoadingJson(loc, pick, getCI);
    const isPassing =
      passing ||
      String(pick(loc, "act") || "").toUpperCase() === "T" ||
      Boolean(wtp && !plat && !ata && !atd);
    if (isPassing && wtp) {
      sta = null;
      std = null;
    }
    locations.push({
      rid,
      tiploc: String(tpl),
      crs: crs ? String(crs) : null,
      seq: seq++,
      is_passing: isPassing ? 1 : 0,
      cancelled: 0,
      platform: platformText(platRaw),
      length_cars: null,
      formation: null,
      loading_percentage: loading.loading_percentage,
      coach_loading: loading.coach_loading,
      sta,
      std,
      wta,
      wtd,
      wtp,
      ata,
      atd,
      atp,
      eta,
      etd,
      etp,
      delay_minutes: null,
      status: null,
      live_kind: liveKind({ ata, atd, atp, eta, etd, etp }),
      actual_source: ata || atd || atp ? "darwin" : null,
      updated_at: Date.now(),
    });
  }
  if (!locations.length) return null;
  const calls = mergeCallsByTiploc(locations);
  const { origin, dest } = publicJourneyEnds(calls);
  return {
    service: {
      rid,
      uid,
      train_id: trainId,
      rs_id: null,
      toc,
      operator_name: toc,
      origin_crs: origin?.crs ?? null,
      origin_name: null,
      destination_crs: dest?.crs ?? null,
      destination_name: null,
      via: null,
      service_type: "passenger",
      cancelled: 0,
      cancel_reason: null,
      delay_reason: null,
      is_charter: 0,
      category: null,
      headcode: /^[0-9][A-Z][0-9]{2}$/i.test(String(trainId || "")) ? String(trainId).toUpperCase() : null,
      formation: parseFormationJson(ts, getCI, pick),
      updated_at: Date.now(),
    },
    calls,
    fullJourney,
    associations: extractDarwinAssociationsJson(flat),
  };
}

function bufferToText(buf) {
  if (!buf?.length) return "";
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return gunzipSync(buf).toString("utf8");
    } catch {
      return buf.toString("utf8");
    }
  }
  const utf = buf.toString("utf8");
  const t = utf.trim();
  if (t.startsWith("<") || t.startsWith("{") || t.startsWith("[")) return utf;
  try {
    return gunzipSync(buf).toString("utf8");
  } catch {
    return utf;
  }
}

function unwrapRdmEnvelope(raw) {
  const s = String(raw).trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return s;
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return s;
  }
  if (obj && typeof obj === "object") {
    if (typeof obj.text === "string" && obj.text.trim().length > 20) return obj.text;
    if (typeof obj.bytes === "string" && obj.bytes.length > 20) {
      const rawBytes = obj.bytes.trim();
      if (rawBytes.startsWith("<") || rawBytes.startsWith("{")) return obj.bytes;
      try {
        const decoded = bufferToText(Buffer.from(obj.bytes, "base64"));
        if (decoded.trim()) return decoded;
      } catch {
        /* ignore */
      }
    }
    if (Array.isArray(obj.bytes) && obj.bytes.length > 20) {
      return Buffer.from(obj.bytes).toString("utf8");
    }
    const b = obj.bytes;
    if (b && typeof b === "object" && Array.isArray(b.data)) {
      return Buffer.from(b.data).toString("utf8");
    }
  }
  const prefer = ["bytesMessage", "text", "xml", "body", "payload", "message", "content", "data"];
  const strings = [];
  const walk = (node, depth) => {
    if (!node || depth > 6) return;
    if (typeof node === "string" && node.length > 40) strings.push(node);
    if (typeof node !== "object") return;
    for (const k of prefer) {
      if (typeof node[k] === "string" && node[k].length > 40) strings.push(node[k]);
    }
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(obj, 0);
  const scored = strings.filter((cand) => {
    const t = cand.trim();
    return t.startsWith("<") || t.startsWith("{") || t.startsWith("[") || /rid=|"rid"|<TS\b|"TS"/.test(t);
  });
  for (const cand of scored.length ? scored : strings) {
    const t = cand.trim();
    if (t.startsWith("<") || t.startsWith("{") || t.startsWith("[")) return t;
    try {
      const decoded = Buffer.from(cand, "base64").toString("utf8");
      const d = decoded.trim();
      if (d.startsWith("<") || d.startsWith("{") || /rid=|"rid"|<TS\b/.test(d)) return decoded;
    } catch {
      /* ignore */
    }
  }
  return s;
}

export function parseDarwinPayload(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("<")) return parseDarwinPportXml(s);
  if (!(s.startsWith("{") || s.startsWith("["))) return parseDarwinPportXml(s);
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof obj?.bytes === "string" && obj.bytes.trim().startsWith("{")) {
    try {
      const inner = JSON.parse(obj.bytes);
      const p = parseDarwinPportJson(inner) || parseDarwinPportJson({ Pport: inner });
      if (p) return p;
    } catch {
      /* continue */
    }
  }
  if (typeof obj?.bytes === "string" && obj.bytes.trim().startsWith("<")) {
    const p = parseDarwinPportXml(obj.bytes);
    if (p) return p;
  }
  if (obj && typeof obj.text === "object" && obj.text && Object.keys(obj.text).length) {
    const p = parseDarwinPportJson(obj.text);
    if (p) return p;
  }
  if (typeof obj?.text === "string" && obj.text.trim().length > 20) {
    const p = parseDarwinPayload(obj.text);
    if (p) return p;
  }
  const unwrapped = unwrapRdmEnvelope(s);
  if (typeof unwrapped === "string" && unwrapped !== s) {
    if (unwrapped.trim().startsWith("<")) return parseDarwinPportXml(unwrapped);
    if (unwrapped.trim().startsWith("{") || unwrapped.trim().startsWith("[")) {
      try {
        const p = parseDarwinPportJson(JSON.parse(unwrapped));
        if (p) return p;
      } catch {
        /* continue */
      }
    }
  }
  const parsed = parseDarwinPportJson(obj);
  const extra = extractDarwinAssociationsJson(obj);
  if (parsed) {
    parsed.associations = [...(parsed.associations || []), ...extra];
    return parsed;
  }
  if (extra.length) return { service: null, calls: [], associations: extra, fullJourney: false };
  return parsed;
}

export function rdmInnerObject(raw) {
  const s = String(raw).trim();
  try {
    const obj = JSON.parse(s);
    if (typeof obj?.bytes === "string" && obj.bytes.trim().startsWith("{")) return JSON.parse(obj.bytes);
    if (typeof obj?.bytes === "string" && obj.bytes.trim().startsWith("<")) return { xml: obj.bytes };
    if (obj && typeof obj === "object" && !obj.destination) return obj;
    return obj;
  } catch {
    return null;
  }
}

export function applyParsed(db, parsed) {
  if (!parsed) return false;
  for (const assoc of parsed.associations || []) upsertAssociation(db, assoc);
  if (!parsed.service) return Boolean(parsed.associations?.length);
  const overlay = parsed.fullJourney === false;
  upsertService(db, parsed.service, { overlay });
  if (parsed.service?.uid && parsed.service?.rid) {
    adoptUidOntoRid(db, parsed.service.uid, parsed.service.rid);
  }
  for (const call of parsed.calls || []) upsertCall(db, call, { overlay });
  return true;
}

export function fingerprint(xml) {
  return createHash("sha1").update(xml).digest("hex");
}
