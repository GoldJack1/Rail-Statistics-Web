/**
 * Live CIS boards — same contract as the old daemon's
 * `buildDeparturesAndArrivalsForTiplocs` in live mode (no history overlay, no dated ctx).
 */
import { platformText } from "./db.js";
import { tocDisplayName } from "./toc-names.js";
import { sortCallsByJourneyTime } from "./journey-order.js";
import { maskCallAsOf, maskCallsAsOf, maskTrustOverlay, maskTrustOverlayCalls } from "./replay-at.js";
import { computeServiceLocation, locationIsFresh } from "./location.js";
import { lookupConsistsForUids } from "./ptac-apply.js";
import { callOnBoardDate, londonInstant } from "./calendar-day.js";

const UK_RAIL_ROLLOVER_MINUTES = 2 * 60;
const LIVE_ACTUAL_HOLD_MS = 30_000;
const LIVE_UNACTUALED_LOOKBACK_MS = 5 * 60_000;

export function anchorTime(hhmm, ssd) {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm);
  if (!m) return null;
  const [, h, mn, s] = m;
  return londonInstant(ssd, `${h.padStart(2, "0")}:${mn}:${s || "00"}`);
}

function scheduledMinutesFromMidnight(hhmm) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function adjustScheduledInstantForRailwayOvernight(scheduledAt, scheduledTime, railwayOvernight = true) {
  if (!railwayOvernight) return scheduledAt;
  const mins = scheduledMinutesFromMidnight(scheduledTime);
  if (mins != null && mins < UK_RAIL_ROLLOVER_MINUTES) {
    return new Date(scheduledAt.getTime() + 24 * 60 * 60_000);
  }
  return scheduledAt;
}

function parseHmToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export function computeDelayMinutes(scheduledTime, liveTime, liveKind) {
  if (!liveTime) return null;
  if (liveKind === "scheduled" || liveKind === "working") return 0;
  const sched = parseHmToMinutes(scheduledTime);
  const live = parseHmToMinutes(liveTime);
  if (sched == null || live == null) return null;
  let diff = live - sched;
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}

export function classifyServiceType({ trainCat, isPassenger, trainId, originName, destinationName }) {
  const cat = String(trainCat || "").toUpperCase();
  const headcodeClass = String(trainId || "").charAt(0);
  const replacementHints = ["rail replacement", "replacement bus", "bus replacement", "bus service"];
  const endpoints = `${originName || ""} ${destinationName || ""}`.toLowerCase();
  if (replacementHints.some((hint) => endpoints.includes(hint))) return "rail-replacement";
  if (cat === "BR" || cat === "BS" || cat.startsWith("B")) return "rail-replacement";
  if (isPassenger) return "passenger";
  if (["4", "6", "7", "8"].includes(headcodeClass)) return "freight";
  if (cat.startsWith("E") || cat.startsWith("F") || cat.startsWith("H") || cat.startsWith("J") || cat.startsWith("M")) {
    return "freight";
  }
  return "other";
}

function boardEventInstant(hhmm, ssd, railwayOvernight = true) {
  if (!hhmm || !String(hhmm).includes(":")) return null;
  const t = anchorTime(hhmm, ssd);
  if (!t) return null;
  return adjustScheduledInstantForRailwayOvernight(t, hhmm, railwayOvernight);
}

/** Live CIS only (closedResults / historicalDate never used). */
export function keepBoardRow({ now, horizon, scheduledAt, liveTime, liveKind, ssd, cancelled, railwayOvernight = true }) {
  if (!scheduledAt) return false;
  const isActual = typeof liveKind === "string" && liveKind.startsWith("actual");
  const liveAt = liveTime ? boardEventInstant(liveTime, ssd, railwayOvernight) : null;
  const predictedAt = liveAt && liveAt.getTime() > scheduledAt.getTime() ? liveAt : scheduledAt;
  const windowAt = !cancelled ? predictedAt : scheduledAt;
  if (windowAt > horizon) return false;
  if (cancelled && !isActual) {
    return now.getTime() < scheduledAt.getTime() + LIVE_ACTUAL_HOLD_MS;
  }
  if (isActual) {
    const actualAt = liveAt || scheduledAt;
    return now.getTime() < actualAt.getTime() + LIVE_ACTUAL_HOLD_MS;
  }
  return predictedAt.getTime() >= now.getTime() - LIVE_UNACTUALED_LOOKBACK_MS;
}

export function liveClockFromCall(call, movement) {
  if (!call) return { time: null, kind: null };
  if (movement === "arrival") {
    if (call.ata) return { time: call.ata, kind: "actual-arr" };
    if (call.eta) return { time: call.eta, kind: "est-arr" };
    if (call.atd) return { time: call.atd, kind: "actual" };
    if (call.etd) return { time: call.etd, kind: "est" };
    return { time: null, kind: null };
  }
  if (call.atd) return { time: call.atd, kind: "actual" };
  if (call.etd) return { time: call.etd, kind: "est" };
  if (call.atp) return { time: call.atp, kind: "actual" };
  if (call.etp) return { time: call.etp, kind: "est" };
  if (call.ata) return { time: call.ata, kind: "actual-arr" };
  if (call.eta) return { time: call.eta, kind: "est-arr" };
  return { time: null, kind: null };
}

function isPassengerCall(c) {
  if (Number(c.is_passing)) return false;
  if (!c.crs) return false;
  return Boolean(c.sta || c.std);
}

function slotOf(call, journey) {
  if (Number(call.is_passing) || (!call.sta && !call.std && call.wtp)) return "PP";
  const pax = journey.filter(isPassengerCall);
  if (!pax.length) return "IP";
  if (pax[0] === call || (pax[0].tiploc === call.tiploc && pax[0].seq === call.seq)) return "OR";
  const last = pax[pax.length - 1];
  if (last === call || (last.tiploc === call.tiploc && last.seq === call.seq)) return "DT";
  return "IP";
}

function coachLoadingFromCall(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed
      .filter((item) => item && item.number != null && Number.isFinite(Number(item.value)))
      .map((item) => ({ number: String(item.number), value: Number(item.value) }));
  } catch {
    return null;
  }
}

function liveStatus({ cancelInfo, unknownDelay, delayMinutes, bestKind, bestTime }) {
  if (cancelInfo) return "CANCELLED";
  if (unknownDelay) return "delayed";
  if (delayMinutes == null) {
    return bestKind === "scheduled" || bestKind === "working" ? "on time" : `${bestKind} ${bestTime}`;
  }
  return delayMinutes === 0 ? "on time" : `${bestKind} ${bestTime} (${delayMinutes > 0 ? "+" : ""}${delayMinutes}m)`;
}

export function buildStationBoard({
  db,
  ymd,
  crs,
  tiplocs,
  hours,
  now,
  passengersOnly,
  stationName,
  matchBy,
  at,
  historicalDate,
  railwayOvernight = true,
  cisMode = false,
  fullDay = false,
  boardDate = null,
  consistByUid = null,
  catalog = null,
}) {
  const code = String(crs).toUpperCase();
  const tpls = (tiplocs || []).map((t) => String(t).toUpperCase());
  const placeholders = tpls.map(() => "?").join(",") || "NULL";
  const tiplocOnly = matchBy === "tiploc" && tpls.length > 0;
  const q = db.prepare(
    `SELECT c.*, s.rid as s_rid, s.uid, s.rs_id, s.toc, s.operator_name, s.origin_crs, s.origin_name,
            s.destination_crs, s.destination_name, s.via, s.service_type, s.cancelled as s_cancelled,
            s.cancel_reason, s.delay_reason, s.is_charter, s.category, s.headcode, s.train_id
     FROM calls c JOIN services s ON s.rid = c.rid
     WHERE ${tiplocOnly ? `c.tiploc IN (${placeholders})` : `(c.crs = ? ${tpls.length ? `OR c.tiploc IN (${placeholders})` : ""})`}`
  );
  const rows = tiplocOnly ? q.all(...tpls) : q.all(code, ...tpls);
  if (!consistByUid && catalog) {
    consistByUid = lookupConsistsForUids(
      catalog,
      ymd,
      rows.map((r) => r.uid),
    );
  }
  const rids = [...new Set(rows.map((r) => r.s_rid))];
  const callsByRid = new Map();
  if (rids.length) {
    const chunk = 400;
    for (let i = 0; i < rids.length; i += chunk) {
      const part = rids.slice(i, i + chunk);
      const ins = part.map(() => "?").join(",");
      const calls = db
        .prepare(`SELECT * FROM calls WHERE rid IN (${ins}) ORDER BY seq, COALESCE(std, sta, wtd, wta, wtp, '99:99')`)
        .all(...part);
      for (const c of calls) {
        if (!callsByRid.has(c.rid)) callsByRid.set(c.rid, []);
        callsByRid.get(c.rid).push(c);
      }
    }
    for (const [rid, list] of callsByRid) {
      callsByRid.set(rid, sortCallsByJourneyTime(list));
    }
  }

  const clock = now instanceof Date ? now : new Date();
  const historical = Boolean(historicalDate);
  const dateKey = boardDate || historicalDate || ymd;
  const skipWindow = Boolean(fullDay) || historical;
  const horizon = new Date(clock.getTime() + Math.max(1, hours) * 3600_000);
  const departures = [];
  const arrivals = [];
  const seenDepRid = new Set();
  const seenArrRid = new Set();

  for (const raw of rows) {
    const asOf = maskCallsAsOf(callsByRid.get(raw.s_rid) || [], at);
    const journey = cisMode ? maskTrustOverlayCalls(asOf) : asOf;
    const r = cisMode ? maskTrustOverlay(maskCallAsOf(raw, at)) : maskCallAsOf(raw, at);
    const loc = computeServiceLocation(journey, { stationName, now: clock, ymd });
    const locFresh = !historical && !at && loc.last?.at && locationIsFresh(loc.last.at, ymd, clock);
    const pax = journey.filter(isPassengerCall);
    const originCall = pax[0];
    const destCall = pax[pax.length - 1];
    const originCrs = originCall?.crs || r.origin_crs || null;
    const destCrs = destCall?.crs || r.destination_crs || null;
    const originTpl = originCall?.tiploc || r.origin_name || originCrs || "";
    const destTpl = destCall?.tiploc || r.destination_name || destCrs || "";
    const originName = stationName(originCrs, originTpl) || r.origin_name || originCrs || originTpl;
    const destName = stationName(destCrs, destTpl) || r.destination_name || destCrs || destTpl;
    const trainIdRaw = r.headcode || r.train_id || "";
    const trainId = /^[0-9][A-Z][0-9]{2}$/i.test(trainIdRaw) ? String(trainIdRaw).toUpperCase() : "";
    const isPassenger = r.service_type !== "freight";
    const serviceType = classifyServiceType({
      trainCat: r.category,
      isPassenger,
      trainId,
      originName,
      destinationName: destName,
    });
    if (passengersOnly && serviceType !== "passenger" && serviceType !== "rail-replacement") continue;

    const schedClock = r.std || r.sta || r.wtd || r.wta || r.wtp;
    if (dateKey && schedClock && !callOnBoardDate(ymd, schedClock, dateKey)) continue;

    const slot = slotOf(r, pax.length ? pax : journey);
    const sourceTpl = String(r.tiploc || "").toUpperCase();
    const hereIdx = pax.findIndex((c) => c.seq === r.seq && c.tiploc === r.tiploc);
    const after = hereIdx >= 0 ? pax.slice(hereIdx + 1) : [];
    const viaNames = after.slice(0, 3).map((c) => stationName(c.crs, c.tiploc)).filter(Boolean);
    const via = r.via || (viaNames.length ? viaNames.join(", ") : null);
    const toc = r.toc || "";
    const tocName = tocDisplayName(toc) || (toc.length === 2 ? null : r.operator_name) || null;
    const consistRow = consistByUid?.get(String(r.uid || "").toUpperCase()) || null;
    let unitIds = [];
    try {
      unitIds = consistRow?.unit_ids ? JSON.parse(consistRow.unit_ids) : [];
    } catch {
      unitIds = [];
    }
    const cancelInfo = r.s_cancelled || r.cancelled ? { source: "ts", reason: r.cancel_reason || "Cancelled" } : null;
    const plat = platformText(r.platform);
    const isPassing = slot === "PP";

    const baseRow = () => ({
      rid: r.s_rid,
      trainId,
      uid: r.uid,
      toc,
      tocName,
      trainCat: r.category || null,
      serviceType,
      origin: originTpl,
      originName,
      originCrs,
      destination: destTpl,
      destinationName: destName,
      destinationCrs: destCrs,
      via,
      callingAfter: [],
      callingAfterNames: [],
      callingAfterCrs: [],
      isPassenger,
      cancelled: Boolean(cancelInfo),
      cancellation: cancelInfo,
      delayReason: r.delay_reason ? { source: "ts", reason: r.delay_reason } : null,
      trainLength: r.length_cars ?? null,
      platform: plat,
      livePlatform: plat,
      loadingPercentage: r.loading_percentage ?? null,
      coachLoading: coachLoadingFromCall(r.coach_loading),
      reverseFormation: false,
      hasAssociations: false,
      hasAlerts: false,
      hasConsist: unitIds.length > 0,
      hasFormation: false,
      formation: null,
      unitIds: unitIds.length ? unitIds : null,
      sourceTiploc: sourceTpl,
      actualSource: r.actual_source,
      locationLabel: locFresh ? loc.label : null,
    });

    if (!seenDepRid.has(r.s_rid)) {
      const skipDep = slot === "DT" || r.activity === "TF";
      if (!skipDep) {
        const scheduledTime = isPassing ? r.wtp || r.wtd : r.std || r.wtd;
        if (scheduledTime && String(scheduledTime).includes(":")) {
          let scheduledAt = anchorTime(scheduledTime, ymd);
          if (scheduledAt) {
            scheduledAt = adjustScheduledInstantForRailwayOvernight(scheduledAt, scheduledTime, railwayOvernight);
            const clockLive = liveClockFromCall(r, "departure");
            if (
              skipWindow ||
              keepBoardRow({
                now: clock,
                horizon,
                scheduledAt,
                liveTime: clockLive.time,
                liveKind: clockLive.kind,
                ssd: ymd,
                cancelled: Boolean(cancelInfo),
                railwayOvernight,
              })
            ) {
              seenDepRid.add(r.s_rid);
              const bestTime = clockLive.time || scheduledTime;
              const bestKind = clockLive.kind || "scheduled";
              const delayMinutes = computeDelayMinutes(scheduledTime, bestTime, bestKind);
              departures.push({
                ...baseRow(),
                movement: "departure",
                isPassing,
                scheduledTime: String(scheduledTime).slice(0, 5),
                scheduledAt: scheduledAt.toISOString(),
                liveTime: bestTime,
                liveKind: bestKind,
                unknownDelay: false,
                delayMinutes,
                status: liveStatus({ cancelInfo, unknownDelay: false, delayMinutes, bestKind, bestTime }),
              });
            }
          }
        }
      }
    }

    if (!seenArrRid.has(r.s_rid)) {
      const arrivalEligible = slot === "DT" || slot === "IP";
      if (arrivalEligible) {
        const scheduledTime =
          slot === "DT" ? r.sta || r.wta || r.std || r.wtd : r.sta || r.wta || r.std || r.wtd;
        if (scheduledTime && String(scheduledTime).includes(":")) {
          let scheduledAt = anchorTime(scheduledTime, ymd);
          if (scheduledAt) {
            scheduledAt = adjustScheduledInstantForRailwayOvernight(scheduledAt, scheduledTime, railwayOvernight);
            const clockLive = liveClockFromCall(r, "arrival");
            if (
              skipWindow ||
              keepBoardRow({
                now: clock,
                horizon,
                scheduledAt,
                liveTime: clockLive.time,
                liveKind: clockLive.kind,
                ssd: ymd,
                cancelled: Boolean(cancelInfo),
                railwayOvernight,
              })
            ) {
              seenArrRid.add(r.s_rid);
              const bestTime = clockLive.time || scheduledTime;
              const bestKind = clockLive.kind || "scheduled";
              const delayMinutes = computeDelayMinutes(scheduledTime, bestTime, bestKind);
              arrivals.push({
                ...baseRow(),
                movement: "arrival",
                isPassing: false,
                scheduledTime: String(scheduledTime).slice(0, 5),
                scheduledAt: scheduledAt.toISOString(),
                liveTime: bestTime,
                liveKind: bestKind,
                unknownDelay: false,
                delayMinutes,
                status: liveStatus({ cancelInfo, unknownDelay: false, delayMinutes, bestKind, bestTime }),
              });
            }
          }
        }
      }
    }
  }

  departures.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  arrivals.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const generatedAt = new Date().toISOString();
  const nameTpl = tpls[0] || null;
  const station = (typeof stationName === "function" ? stationName(code, nameTpl) : null) || code;
  return {
    tiploc: tpls[0] || code,
    tiplocs: tpls.length > 1 ? tpls : undefined,
    stationName: station,
    stationCrs: code,
    code,
    crs: code,
    matchedAs: tiplocOnly ? "tiploc" : "crs",
    name: station,
    generatedAt,
    updatedAt: generatedAt,
    historicalDate: historicalDate || null,
    historicalAt: at || null,
    windowHours: hours,
    counts: {
      departures: departures.length,
      arrivals: arrivals.length,
      cancelled: [...departures, ...arrivals].filter((s) => s.cancelled).length,
      withDelay: [...departures, ...arrivals].filter((s) => s.delayReason).length,
      messages: 0,
    },
    messages: [],
    kafka: {
      consumed: 0,
      updatesApplied: 0,
      startedAt: generatedAt,
      lastMessageAt: generatedAt,
    },
    services: departures,
    departures,
    arrivals,
    timetableFile: "",
  };
}
