/**
 * Apply Network Rail VSTP schedule JSON onto Darwin day calls (same merge as ITPS overlay).
 */
import { operatingDayYmd } from "./db.js";
import { overlayOneWorking, workingFromScheduleJson } from "./cif-overlay.js";

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

export function applyVstpFrame(dataDir, message, ymd = operatingDayYmd()) {
  const schedule = unwrapSchedule(message);
  if (!schedule) return false;
  const day = scheduleDay(schedule);
  const target = /^\d{4}-\d{2}-\d{2}$/.test(day || "") ? day : ymd;
  // Only touch today / tomorrow — VSTP can include far dates we do not want to rewrite.
  if (target !== ymd) {
    const tomorrow = (() => {
      const [y, m, d] = ymd.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + 1));
      return t.toISOString().slice(0, 10);
    })();
    if (target !== tomorrow) return false;
  }
  const stp = String(schedule.CIF_stp_indicator || schedule.stp_indicator || "N").toUpperCase();
  if (stp === "C") return false;
  const working = workingFromScheduleJson(schedule, { rank: 4, source: "vstp" });
  if (!working) return false;
  const out = overlayOneWorking(dataDir, target, working);
  return out.services > 0 || out.inserted > 0;
}
