/**
 * Apply Network Rail VSTP schedule JSON onto Darwin day calls (same merge as ITPS overlay).
 */
import { addCalendarDays } from "./calendar-day.js";
import { openDayDb, operatingDayYmd } from "./db.js";
import { overlayOneWorking, workingFromScheduleJson } from "./cif-overlay.js";
import { nrodCandidateDays, writeDaysForRid } from "./nrod-write-days.js";

export function vstpMessages(raw) {
  if (raw == null) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    parsed = JSON.parse(s);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed.VSTPCIFMsgV1 || parsed.schedule || parsed.body) return [parsed];
  return [];
}

function unwrapSchedule(msg) {
  const root = msg?.VSTPCIFMsgV1 || msg?.body?.VSTPCIFMsgV1 || msg?.body || msg;
  return root?.schedule || root?.Schedule || null;
}

function scheduleDay(schedule) {
  return (
    schedule?.schedule_start_date ||
    schedule?.CIF_start_date ||
    schedule?.start_date ||
    null
  );
}

function ridsForUid(dataDir, day, uid) {
  const db = openDayDb(dataDir, day);
  try {
    return db
      .prepare(
        `SELECT rid FROM services
         WHERE uid = ? COLLATE NOCASE
           AND length(rid)=15 AND rid GLOB '[0-9]*'`,
      )
      .all(String(uid).toUpperCase())
      .map((r) => r.rid);
  } finally {
    db.close();
  }
}

export function applyVstpFrame(dataDir, message, ymd = operatingDayYmd()) {
  const schedule = unwrapSchedule(message);
  if (!schedule) return false;
  const day = scheduleDay(schedule);
  const target = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : ymd;
  const tomorrow = addCalendarDays(ymd, 1);
  // Only touch today / tomorrow — VSTP can include far dates we do not want to rewrite.
  if (target !== ymd && target !== tomorrow) return false;
  const stp = String(schedule.CIF_stp_indicator || schedule.stp_indicator || "N").toUpperCase();
  if (stp === "C") return false;
  const working = workingFromScheduleJson(schedule, { rank: 4, source: "vstp" });
  if (!working) return false;

  const days = new Set();
  for (const cand of nrodCandidateDays(ymd)) {
    if (cand !== ymd && cand !== tomorrow) continue;
    for (const rid of ridsForUid(dataDir, cand, working.uid)) {
      for (const writeDay of writeDaysForRid(dataDir, ymd, rid)) {
        if (writeDay === ymd || writeDay === tomorrow) days.add(writeDay);
      }
    }
  }
  if (!days.size && (target === ymd || target === tomorrow)) days.add(target);

  let applied = false;
  for (const writeDay of days) {
    const out = overlayOneWorking(dataDir, writeDay, working);
    if (out.services > 0 || out.inserted > 0) applied = true;
  }
  return applied;
}
