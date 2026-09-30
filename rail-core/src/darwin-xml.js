import { createHash } from "node:crypto";
import { hhmm, liveKind, upsertCall, upsertService } from "./db.js";

function text(el) {
  if (!el) return "";
  return String(el).trim();
}

/** Minimal Darwin PPort XML: extract TS and schedule-like attributes from a raw string. */
export function parseDarwinPportXml(xml) {
  const rid = xml.match(/\brid="([^"]+)"/)?.[1];
  if (!rid) return null;
  const uid = xml.match(/\buid="([^"]+)"/)?.[1] ?? null;
  const toc = xml.match(/\btoc="([^"]+)"/)?.[1] ?? null;
  const trainId = xml.match(/\btrainId="([^"]+)"/)?.[1] ?? null;
  const isCancel = /<ns\d*:cancel|<cancel[\s>]/i.test(xml) ? 1 : 0;

  const locations = [];
  const locRe =
    /<(?:ns\d*:)?(?:OR|OPOR|IP|OPIP|PP|DT|OPDT)\b([^>]*)>([\s\S]*?)<\/(?:ns\d*:)?(?:OR|OPOR|IP|OPIP|PP|DT|OPDT)>/gi;
  let m;
  let seq = 0;
  while ((m = locRe.exec(xml))) {
    const attrs = m[1];
    const inner = m[2];
    const tag = m[0].match(/<(?:ns\d*:)?([A-Z]+)/i)?.[1]?.toUpperCase() ?? "";
    const isPassing = tag === "PP" || tag.includes("PP") ? 1 : 0;
    const tpl = attrs.match(/\btpl="([^"]+)"/)?.[1] ?? "";
    const crs = attrs.match(/\bcrs="([^"]+)"/)?.[1] ?? null;
    const plat = inner.match(/\bplat(?:form)?="([^"]+)"/)?.[1] ?? inner.match(/<(?:ns\d*:)?plat[^>]*>([^<]+)/i)?.[1];
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
    const sta = hhmm(pick("pta") || pick("sta"));
    const std = hhmm(pick("ptd") || pick("std"));
    const wta = hhmm(pick("wta"));
    const wtd = hhmm(pick("wtd"));
    const wtp = hhmm(pick("wtp"));
    locations.push({
      rid,
      tiploc: tpl,
      crs,
      seq: seq++,
      is_passing: isPassing,
      cancelled: 0,
      platform: plat ?? null,
      length_cars: null,
      formation: null,
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
  if (!locations.length) return null;
  const origin = locations.find((l) => l.crs && !l.is_passing);
  const dest = [...locations].reverse().find((l) => l.crs && !l.is_passing);
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
      updated_at: Date.now(),
    },
    calls: locations,
  };
}

export function parseDarwinPportJson(obj) {
  if (!obj || typeof obj !== "object") return null;
  const hits = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const rid = node.rid || node["@rid"] || node.$?.rid;
    if (rid && (node.Location || node.OR || node.IP || node.PP || node.DT || node.location)) hits.push(node);
    for (const v of Object.values(node)) {
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(obj);
  const ts = hits[0];
  if (!ts) return null;
  const rid = String(ts.rid || ts["@rid"]);
  const uid = ts.uid || ts["@uid"] || null;
  const toc = ts.toc || ts["@toc"] || null;
  const trainId = ts.trainId || ts["@trainId"] || null;
  const buckets = [];
  const pushLoc = (item, passing) => {
    if (!item) return;
    for (const loc of Array.isArray(item) ? item : [item]) {
      buckets.push({ loc, passing });
    }
  };
  pushLoc(ts.PP || ts.pp, true);
  pushLoc(ts.Location || ts.location || ts.IP || ts.OR || ts.DT, false);
  if (!ts.PP && !ts.Location) {
    for (const key of ["OR", "OPOR", "IP", "OPIP", "PP", "DT", "OPDT"]) pushLoc(ts[key], key.includes("PP"));
  }
  const locations = [];
  let seq = 0;
  for (const { loc, passing } of buckets) {
    const g = (k) => loc[k] ?? loc[`@${k}`];
    const tpl = g("tpl") || "";
    const crs = g("crs") || null;
    const isPassing = passing || String(g("act") || "").toUpperCase() === "T" || Boolean(g("wtp") && !g("ptd") && !g("pta"));
    const ata = hhmm(g("ata"));
    const atd = hhmm(g("atd"));
    const atp = hhmm(g("atp") || g("pass"));
    const eta = hhmm(g("eta"));
    const etd = hhmm(g("etd"));
    const etp = hhmm(g("etp"));
    const sta = hhmm(g("pta") || g("sta"));
    const std = hhmm(g("ptd") || g("std"));
    const wta = hhmm(g("wta"));
    const wtd = hhmm(g("wtd"));
    const wtp = hhmm(g("wtp"));
    locations.push({
      rid,
      tiploc: String(tpl),
      crs: crs ? String(crs) : null,
      seq: seq++,
      is_passing: isPassing ? 1 : 0,
      cancelled: 0,
      platform: g("plat") || g("platform") || null,
      length_cars: null,
      formation: null,
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
  const origin = locations.find((l) => l.crs && !l.is_passing);
  const dest = [...locations].reverse().find((l) => l.crs && !l.is_passing);
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
      headcode: trainId,
      updated_at: Date.now(),
    },
    calls: locations,
  };
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
      try {
        const decoded = Buffer.from(obj.bytes, "base64").toString("utf8");
        if (decoded.trim()) return decoded;
      } catch {
        /* ignore */
      }
    }
    if (Array.isArray(obj.bytes) && obj.bytes.length > 20) {
      return Buffer.from(obj.bytes).toString("utf8");
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
  const s = unwrapRdmEnvelope(raw);
  if (!s) return null;
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      return parseDarwinPportJson(JSON.parse(s));
    } catch {
      return null;
    }
  }
  return parseDarwinPportXml(s);
}

export function applyParsed(db, parsed) {
  if (!parsed) return false;
  upsertService(db, parsed.service);
  for (const call of parsed.calls) upsertCall(db, call);
  return true;
}

export function fingerprint(xml) {
  return createHash("sha1").update(xml).digest("hex");
}
