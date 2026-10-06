/**
 * TRUST / TD / VSTP write the same sqlite day files as Darwin Kafka.
 */
import { addCalendarDays, darwinWriteDays, ssdFromRid } from "./calendar-day.js";
import { openDayDb } from "./db.js";

export function nrodCandidateDays(operatingDay) {
  const op = String(operatingDay);
  return [op, addCalendarDays(op, -1), addCalendarDays(op, 1)];
}

export function hasRidOnDay(dataDir, day, rid) {
  if (!rid || !day) return false;
  const db = openDayDb(dataDir, day);
  try {
    return Boolean(db.prepare(`SELECT 1 AS n FROM services WHERE rid = ?`).get(rid));
  } finally {
    db.close();
  }
}

export function writeDaysForRid(dataDir, operatingDay, rid) {
  if (!rid) return [String(operatingDay)];
  const ridDay = ssdFromRid(rid);
  return darwinWriteDays(operatingDay, ridDay, (day) => hasRidOnDay(dataDir, day, rid));
}

export function withDayDb(dataDir, ymd, fn) {
  const db = openDayDb(dataDir, ymd);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
