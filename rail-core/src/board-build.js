/**
 * Live CIS boards — same contract as the old daemon's
 * `buildDeparturesAndArrivalsForTiplocs` in live mode (no history overlay, no dated ctx).
 */
import { platformText } from "./db.js";
import { tocDisplayName } from "./toc-names.js";
import { callScheduledMinutes, dropCifTailAfterPublicTerminus, isPublicPassengerCall, isWorkingPass, recoverBookedPublic, sortCallsByJourneyTime } from "./journey-order.js";
import { isPassengerHeadcode } from "./headcode.js";
import { maskCallAsOf, maskCallsAsOf, maskTrustOverlay, maskTrustOverlayCalls } from "./replay-at.js";
import { computeServiceLocation, locationIsFresh } from "./location.js";
import { lookupConsistsForUids, unitIdsAtBoardCall } from "./ptac-apply.js";
import { associationsForRid, combinedDestinationName, filterDisplayAssociations, inferAssociationsFromConsist, mergeAssociations } from "./associations.js";
import { callOnBoardDate, isOvernightSleeperJourney, londonInstant, ridVisibleOnBoard } from "./calendar-day.js";

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

function overnightSleeperRidSet(db, rows) {
  const out = new Set();
  const gwNeedTimes = [];
  const seen = new Set();
  for (const r of rows || []) {
    const rid = r.s_rid || r.rid;
    if (!rid || seen.has(rid)) continue;
    seen.add(rid);
    const toc = String(r.toc || "").toUpperCase();
    if (toc === "CS") {
      out.add(rid);
      continue;
    }
    if (toc !== "GW") continue;
    if (isOvernightSleeperJourney(toc, r.category, null, null)) {
      out.add(rid);
      continue;
    }
    gwNeedTimes.push(rid);
  }
  if (!gwNeedTimes.length) return out;
  const chunk = 400;
  for (let i = 0; i < gwNeedTimes.length; i += chunk) {
    const part = gwNeedTimes.slice(i, i + chunk);
    const ins = part.map(() => "?").join(",");
    const calls = db.prepare(`SELECT * FROM calls WHERE rid IN (${ins})`).all(...part);
    const byRid = new Map();
    for (const c of calls) {
      if (!byRid.has(c.rid)) byRid.set(c.rid, []);
      byRid.get(c.rid).push(c);
    }
    for (const rid of part) {
      const pax = sortCallsByJourneyTime(byRid.get(rid) || []).filter((c) => !Number(c.is_passing));
      if (pax.length < 2) continue;
      const first = callScheduledMinutes(pax[0]);
      const last = callScheduledMinutes(pax[pax.length - 1]);
      if (isOvernightSleeperJourney("GW", null, first, last)) out.add(rid);
    }
  }
  return out;
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

function liveRank(row) {
  const k = String(row.liveKind || "");
  if (k.startsWith("actual")) return 3;
  if (k.startsWith("est")) return 2;
  if (k === "working") return 1;
  return 0;
}

function sameBoardTrain(a, b) {
  if ((a.movement || "departure") !== (b.movement || "departure")) return false;
  if (Boolean(a.isPassing) !== Boolean(b.isPassing)) return false;
  const ta = parseHmToMinutes(a.scheduledTime);
  const tb = parseHmToMinutes(b.scheduledTime);
  if (ta == null || tb == null) return false;
  let d = Math.abs(ta - tb);
  if (d > 720) d = 1440 - d;
  if (d > 2) return false;
  const ua = String(a.uid || "").toUpperCase();
  const ub = String(b.uid || "").toUpperCase();
  if (ua && ub && ua === ub) return true;
  const ha = String(a.trainId || "").toUpperCase();
  const hb = String(b.trainId || "").toUpperCase();
  if (!ha || ha !== hb) return false;
  const da = String(a.destinationCrs || "").toUpperCase();
  const db = String(b.destinationCrs || "").toUpperCase();
  if (da && db && da !== db) return false;
  return true;
}

function preferBoardRow(a, b) {
  const score = (row) =>
    (/^\d{15}$/.test(String(row.rid || "")) ? 20 : 0) +
    liveRank(row) * 10 +
    (row.unitIds?.length ? 2 : 0) +
    (row.originCrs ? 1 : 0) +
    (row.destinationCrs ? 1 : 0) +
    (row.toc ? 1 : 0) +
    (row.destinationName ? 1 : 0);
  return score(a) >= score(b) ? a : b;
}

/** Same headcode, within 2 minutes — Darwin next-day RID next to today's live row. */
export function collapseDuplicateBoardRows(rows) {
  const out = [];
  for (const row of rows || []) {
    const i = out.findIndex((keep) => sameBoardTrain(keep, row));
    if (i < 0) out.push(row);
    else out[i] = preferBoardRow(out[i], row);
  }
  return out.sort((a, b) => String(a.scheduledAt || "").localeCompare(String(b.scheduledAt || "")));
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
  // Arrived, not yet departed: treat as at platform even when an ETD is still published.
  if (call.ata) return { time: call.ata, kind: "actual-arr" };
  if (call.etd) return { time: call.etd, kind: "est" };
  if (call.atp) return { time: call.atp, kind: "actual" };
  if (call.etp) return { time: call.etp, kind: "est" };
  if (call.eta) return { time: call.eta, kind: "est-arr" };
  return { time: null, kind: null };
}

function isPassengerCall(c) {
  return isPublicPassengerCall(c);
}

function slotOf(call, journey) {
  if (Number(call.is_passing) || isWorkingPass(call)) return "PP";
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
  const allRows = tiplocOnly ? q.all(...tpls) : q.all(code, ...tpls);

  const clock = now instanceof Date ? now : new Date();
  const historical = Boolean(historicalDate);
  const dateKey = boardDate || historicalDate || ymd;
  const skipWindow = Boolean(fullDay) || historical;
  const horizon = new Date(clock.getTime() + Math.max(1, hours) * 3600_000);

  const sleeperRids = overnightSleeperRidSet(db, allRows);
  const rows = allRows.filter((raw) => {
    const r = recoverBookedPublic(cisMode ? maskTrustOverlay(maskCallAsOf(raw, at)) : maskCallAsOf(raw, at));
    const schedClock = r.std || r.sta || r.wtd || r.wta || r.wtp;
    if (!schedClock || !String(schedClock).includes(":")) return false;
    if (dateKey && !callOnBoardDate(ymd, schedClock, dateKey)) return false;
    if (
      dateKey &&
      !ridVisibleOnBoard(r.s_rid, schedClock, dateKey, {
        overnightSleeper: sleeperRids.has(r.s_rid),
      })
    ) {
      return false;
    }
    if (skipWindow) return true;
    let scheduledAt = anchorTime(schedClock, ymd);
    if (!scheduledAt) return false;
    scheduledAt = adjustScheduledInstantForRailwayOvernight(scheduledAt, schedClock, railwayOvernight);
    const clockLive = liveClockFromCall(r, r.std || r.wtd || r.wtp ? "departure" : "arrival");
    return keepBoardRow({
      now: clock,
      horizon,
      scheduledAt,
      liveTime: clockLive.time,
      liveKind: clockLive.kind,
      ssd: ymd,
      cancelled: Boolean(r.s_cancelled || r.cancelled),
      railwayOvernight,
    });
  });

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
      callsByRid.set(rid, sortCallsByJourneyTime(dropCifTailAfterPublicTerminus(list)));
    }
  }
  const departures = [];
  const arrivals = [];
  const seenDepRid = new Set();
  const seenArrRid = new Set();
  const assocByRid = new Map();

  for (const raw of rows) {
    const asOf = maskCallsAsOf(callsByRid.get(raw.s_rid) || [], at);
    const journey = cisMode ? maskTrustOverlayCalls(asOf) : asOf;
    const r = recoverBookedPublic(cisMode ? maskTrustOverlay(maskCallAsOf(raw, at)) : maskCallAsOf(raw, at));
    const loc = computeServiceLocation(journey, { stationName, now: clock, ymd });
    const locFresh = !historical && !at && loc.last?.at && locationIsFresh(loc.last.at, ymd, clock);
    const pax = journey.filter(isPassengerCall);
    const originCall = pax[0];
    const destCall = pax[pax.length - 1];
    const originCrs = originCall?.crs || (originCall ? null : r.origin_crs) || null;
    const destCrs = destCall?.crs || (destCall ? null : r.destination_crs) || null;
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
    if (passengersOnly && trainId && !isPassengerHeadcode(trainId)) continue;

    const schedClock = r.std || r.sta || r.wtd || r.wta || r.wtp;

    const slot = slotOf(r, pax.length ? pax : journey);
    const sourceTpl = String(r.tiploc || "").toUpperCase();
    const hereIdx = pax.findIndex((c) => c.seq === r.seq && c.tiploc === r.tiploc);
    const after = hereIdx >= 0 ? pax.slice(hereIdx + 1) : [];
    const viaNames = after.slice(0, 3).map((c) => stationName(c.crs, c.tiploc)).filter(Boolean);
    const via = r.via || (viaNames.length ? viaNames.join(", ") : null);
    const toc = r.toc || "";
    const tocName = tocDisplayName(toc) || (toc.length === 2 ? null : r.operator_name) || null;
    const consistRow = consistByUid?.get(String(r.uid || "").toUpperCase()) || null;
    let consistDoc = null;
    if (consistRow?.json) {
      try {
        consistDoc = typeof consistRow.json === "object" ? consistRow.json : JSON.parse(consistRow.json);
      } catch {
        consistDoc = null;
      }
    }
    let associations = assocByRid.get(r.s_rid);
    if (!associations) {
      associations = filterDisplayAssociations(
        mergeAssociations(
          associationsForRid(db, r.s_rid, stationName),
          consistDoc
            ? inferAssociationsFromConsist({
                db,
                catalog,
                ymd,
                svc: { rid: r.s_rid, uid: r.uid },
                consist: consistDoc,
                stationName,
              })
            : [],
        ),
        toc,
        pax.map((c) => c.tiploc),
      );
      assocByRid.set(r.s_rid, associations);
    }
    const destNameShown = combinedDestinationName(destName, associations, toc, pax.map((c) => c.tiploc));
    const associationDestinations = [...new Set(
      (associations || [])
        .filter((a) => a.category === "VV" && a.role === "main" && !a.isCancelled && a.otherDestinationName)
        .map((a) => a.otherDestinationName),
    )];
    const movement = r.std || r.wtd ? "departure" : "arrival";
    const unitIds = consistRow
      ? unitIdsAtBoardCall(consistRow, { tiploc: sourceTpl, hhmm: schedClock, movement })
      : [];
    const cancelInfo = r.s_cancelled || r.cancelled ? { source: "ts", reason: r.cancel_reason || "Cancelled" } : null;
    const plat = platformText(r.platform);
    const isPassing = slot === "PP";
    if (passengersOnly && isPassing) continue;

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
      destinationName: destNameShown,
      destinationCrs: destCrs,
      associationDestinations,
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
      hasAssociations: associations.some((a) => a.category === "VV" && a.role === "main"),
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
  const depOut = collapseDuplicateBoardRows(departures);
  const arrOut = collapseDuplicateBoardRows(arrivals);
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
      departures: depOut.length,
      arrivals: arrOut.length,
      cancelled: [...depOut, ...arrOut].filter((s) => s.cancelled).length,
      withDelay: [...depOut, ...arrOut].filter((s) => s.delayReason).length,
      messages: 0,
    },
    messages: [],
    kafka: {
      consumed: 0,
      updatesApplied: 0,
      startedAt: generatedAt,
      lastMessageAt: generatedAt,
    },
    services: depOut,
    departures: depOut,
    arrivals: arrOut,
    timetableFile: "",
  };
}
