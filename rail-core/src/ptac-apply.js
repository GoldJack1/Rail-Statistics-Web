import { consistJoinKey } from "./consist-parser.js";
import { parseCore } from "./parse-ptac.js";

export function normalizePtacDay(raw, fallback) {
  let day = String(raw || "").trim();
  if (/^\d{8}$/.test(day)) day = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
  if (day.includes("T")) day = day.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return fallback || null;
}

function clockHhmm(raw) {
  const m = String(raw || "").match(/(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

function joinFromBody(body) {
  const consist = body?.json?.allocations ? body.json : body?.consist;
  const fromConsist = consist ? consistJoinKey(consist) : null;
  const core = parseCore(body.core || body.diagram || consist?.core);
  const originDt = consist?.allocations?.[0]?.trainOriginDateTime || "";
  return {
    ssd: normalizePtacDay(
      body.operating_day || body.operatingDay || fromConsist?.ssd || consist?.startDate || originDt,
      null,
    ),
    headcode: String(body.headcode || fromConsist?.headcode || consist?.headcode || core.headcode || "").toUpperCase(),
    originTpl: String(body.originTpl || body.origin_tpl || fromConsist?.originTpl || "").toUpperCase(),
    originHHMM: clockHhmm(body.originHHMM || body.origin_hhmm || fromConsist?.originHHMM || originDt),
    uid: String(body.uid || core.uid || "").toUpperCase(),
  };
}

function parseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function lookupConsist(catalog, keys = {}) {
  const uid = String(keys.uid || "").toUpperCase();
  const ssd = normalizePtacDay(keys.ssd || keys.operating_day, null);
  const originHHMM = clockHhmm(keys.originHHMM || keys.origin_hhmm);
  const headcode = String(keys.headcode || "").toUpperCase();
  if (uid && ssd) {
    if (originHHMM) {
      const hit = catalog
        .prepare(`SELECT * FROM consists WHERE uid = ? AND ssd = ? AND origin_hhmm = ?`)
        .get(uid, ssd, originHHMM);
      if (hit) return hit;
    }
    const rows = catalog.prepare(`SELECT * FROM consists WHERE uid = ? AND ssd = ?`).all(uid, ssd);
    if (rows.length === 1) return rows[0];
    if (originHHMM) {
      const timed = rows.find((r) => r.origin_hhmm === originHHMM);
      if (timed) return timed;
    }
    if (rows.length) return rows[0];
  }
  const prev = ssd ? catalog.prepare(`SELECT * FROM consists WHERE uid = ? AND ssd = ?`).all(uid, ssd) : [];
  if (uid && ssd && !prev.length) {
    const y = ssd.split("-").map(Number);
    const prevSsd = new Date(Date.UTC(y[0], y[1] - 1, y[2] - 1)).toISOString().slice(0, 10);
    const overnight = catalog.prepare(`SELECT * FROM consists WHERE uid = ? AND ssd = ?`).all(uid, prevSsd);
    if (overnight.length === 1) return overnight[0];
  }
  if (headcode && ssd && !uid) {
    const rows = catalog.prepare(`SELECT * FROM consists WHERE headcode = ? AND ssd = ?`).all(headcode, ssd);
    if (rows.length === 1) return rows[0];
  }
  return null;
}

export function lookupConsistsForUids(catalog, ssd, uids) {
  const map = new Map();
  const unique = [...new Set((uids || []).map((u) => String(u || "").toUpperCase()).filter(Boolean))];
  if (!ssd || !unique.length) return map;
  const chunk = 400;
  for (let i = 0; i < unique.length; i += chunk) {
    const part = unique.slice(i, i + chunk);
    const ins = part.map(() => "?").join(",");
    const rows = catalog.prepare(`SELECT * FROM consists WHERE ssd = ? AND uid IN (${ins})`).all(ssd, ...part);
    for (const row of rows) {
      if (!map.has(row.uid)) map.set(row.uid, row);
    }
  }
  return map;
}

function unitIdsFromAllocations(json) {
  const inner = parseJson(json);
  const ids = [];
  const seen = new Set();
  for (const a of inner.allocations || []) {
    for (const g of a.resourceGroups || []) {
      const id = g?.unitId != null ? String(g.unitId) : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function unitIdsFromRow(row) {
  const fromJson = unitIdsFromAllocations(row?.json);
  if (fromJson.length) return fromJson;
  try {
    const ids = JSON.parse(row?.unit_ids || "[]");
    return Array.isArray(ids) ? ids.map(String) : [];
  } catch {
    return [];
  }
}

export function consistDocument(row, toc) {
  if (!row) return null;
  const inner = parseJson(row.json);
  if (Array.isArray(inner.allocations) && inner.allocations.length) {
    return {
      parsedAt: new Date().toISOString(),
      company: inner.company ?? null,
      companyDarwin: toc || inner.companyDarwin || null,
      core: inner.core ?? null,
      diagramDate: inner.diagramDate || row.ssd,
      allocations: inner.allocations,
    };
  }
  if (inner.allocations) return inner;
  const ids = unitIdsFromRow(row);
  if (!ids.length) return null;
  return {
    parsedAt: new Date().toISOString(),
    company: null,
    companyDarwin: toc || null,
    core: null,
    diagramDate: row.ssd || null,
    allocations: [
      {
        sequenceNumber: 1,
        trainOrigin: null,
        trainOriginDateTime: null,
        trainDest: null,
        trainDestDateTime: null,
        resourceGroupPosition: 1,
        diagramDate: row.ssd || null,
        diagramNo: null,
        allocationOrigin: null,
        allocationOriginDateTime: null,
        allocationOriginMiles: null,
        allocationDestination: null,
        allocationDestinationDateTime: null,
        allocationDestinationMiles: null,
        reversed: false,
        resourceGroups: ids.map((unitId) => ({
          unitId,
          typeOfResource: null,
          typeOfResourceLabel: null,
          fleetId: null,
          status: null,
          endOfDayMiles: null,
          preassignment: null,
          vehicles: [],
        })),
      },
    ],
  };
}

export function unitIdsFromConsistRow(row) {
  return unitIdsFromRow(row);
}

function clockMinutes(raw) {
  const m = String(raw || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Units physically on the train at a board call. Uses PTAC allocation
 * windows so a detached portion is not shown after the divide.
 */
export function unitIdsAtBoardCall(row, { tiploc, hhmm, movement } = {}) {
  const parsed = parseJson(row?.json);
  const allocs = parsed.allocations || [];
  if (!allocs.length) return unitIdsFromRow(row);
  const here = String(tiploc || "").toUpperCase();
  const t = clockMinutes(hhmm);
  const ids = new Set();
  let matched = false;
  for (const a of allocs) {
    const orig = String(a.allocationOrigin?.tiploc || "").toUpperCase();
    const dest = String(a.allocationDestination?.tiploc || "").toUpperCase();
    const o = clockMinutes(a.allocationOriginDateTime);
    const d = clockMinutes(a.allocationDestinationDateTime);
    let cover = false;
    if (movement === "departure" && here && orig === here) cover = true;
    else if (movement === "arrival" && here && dest === here) cover = true;
    else if (t != null && o != null && d != null) {
      cover = o <= d ? t >= o && t <= d : t >= o || t <= d;
    }
    if (!cover) continue;
    matched = true;
    for (const g of a.resourceGroups || []) {
      if (g.unitId) ids.add(String(g.unitId));
    }
  }
  if (!matched) return unitIdsFromRow(row);
  return [...ids];
}

export function endOfDayMilesForUnit(json, unitId) {
  let miles = null;
  for (const alloc of parseJson(json).allocations || []) {
    for (const group of alloc.resourceGroups || []) {
      if (String(group.unitId) !== String(unitId)) continue;
      const n = Number(group.endOfDayMiles);
      if (Number.isFinite(n)) miles = n;
    }
  }
  return miles;
}

function parseStoredUnitJson(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Fleet metadata plus per-diagram-day EndOfDayMiles. */
function upsertFleet(catalog, unitId, body, day) {
  const inner = body.json && typeof body.json === "object" ? body.json : {};
  const classId =
    body.class ?? inner.allocations?.[0]?.resourceGroups?.find((g) => String(g.unitId) === String(unitId))?.fleetId ?? null;
  const vehicles = [];
  for (const alloc of inner.allocations || []) {
    for (const group of alloc.resourceGroups || []) {
      if (String(group.unitId) !== String(unitId)) continue;
      for (const v of group.vehicles || []) vehicles.push(v);
    }
  }
  const prev = catalog.prepare(`SELECT json FROM units WHERE unit_id = ?`).get(unitId);
  const prevInner = parseStoredUnitJson(prev?.json);
  const mileageByDate = { ...(prevInner.mileageByDate || prevInner.endOfDayMileageByDate || {}) };
  const miles = endOfDayMilesForUnit(inner, unitId);
  if (day && miles != null) mileageByDate[day] = miles;
  const last = miles ?? prevInner.last_end_of_day_miles ?? prevInner.lastEndOfDayMiles ?? null;
  catalog.prepare(
    `INSERT INTO units (unit_id, class, operator, json, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(unit_id) DO UPDATE SET
       class=COALESCE(excluded.class, units.class),
       operator=COALESCE(excluded.operator, units.operator),
       json=excluded.json,
       updated_at=excluded.updated_at`,
  ).run(
    unitId,
    classId,
    body.operator ?? inner.companyDarwin ?? null,
    JSON.stringify({
      unit_id: unitId,
      class: classId,
      vehicles,
      mileageByDate,
      last_end_of_day_miles: last,
    }),
    Date.now(),
  );
}

export function applyPtacUnit(catalog, _dbOrBody, maybeBody, fallbackDay) {
  const body = maybeBody && typeof maybeBody === "object" && (maybeBody.unit_id || maybeBody.json || maybeBody.core)
    ? maybeBody
    : _dbOrBody;
  const unitId = String(body.unit_id || body.unitId || body.resourceGroupId || "");
  if (!unitId) return { ok: false, error: "unit_id required" };
  const join = joinFromBody(body);
  const day = join.ssd || normalizePtacDay(body.operating_day || body.operatingDay, fallbackDay);
  upsertFleet(catalog, unitId, body, day);
  if (!day) return { ok: true, unitId, rid: null, day: null };

  const uid = join.uid || "";
  const consistJson = body.json && typeof body.json === "object" ? body.json : { ...(body.json || {}) };
  const fromAlloc = unitIdsFromAllocations(consistJson);
  let unitIds = fromAlloc;
  if (!unitIds.length) {
    try {
      const prev = uid
        ? catalog.prepare(`SELECT unit_ids FROM consists WHERE uid = ? AND ssd = ? AND origin_hhmm = ?`).get(
            uid,
            day,
            join.originHHMM || "",
          )
        : null;
      unitIds = prev?.unit_ids ? JSON.parse(prev.unit_ids) : [];
    } catch {
      unitIds = [];
    }
    if (!unitIds.includes(unitId)) unitIds.push(unitId);
  }

  if (uid) {
    catalog.prepare(
      `INSERT INTO consists (uid, ssd, origin_hhmm, headcode, origin_tpl, unit_ids, json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uid, ssd, origin_hhmm) DO UPDATE SET
         headcode=COALESCE(excluded.headcode, consists.headcode),
         origin_tpl=COALESCE(excluded.origin_tpl, consists.origin_tpl),
         unit_ids=excluded.unit_ids,
         json=excluded.json,
         updated_at=excluded.updated_at`,
    ).run(
      uid,
      day,
      join.originHHMM || "",
      join.headcode || null,
      join.originTpl || null,
      JSON.stringify(unitIds),
      JSON.stringify(consistJson),
      Date.now(),
    );
  }
  return { ok: true, unitId, rid: null, day, uid: uid || null };
}

/** @deprecated ingest-time RID join removed; kept as no-op for old imports. */
export function replayPtac() {
  return 0;
}

export function normalizePtacVehicles(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((v) => ({
    vehicleId: v.vehicleId || v.VehicleId || null,
    typeOfVehicle: v.typeOfVehicle || v.TypeOfVehicle || null,
    position: v.position ?? v.ResourcePosition ?? null,
    plannedGroupId: v.plannedGroupId || v.PlannedResourceGroup || null,
    specificType: v.specificType || v.SpecificType || null,
    lengthMm: v.lengthMm ?? null,
    weightTonnes: v.weightTonnes ?? null,
    livery: v.livery ?? null,
    decor: v.decor ?? null,
    specialCharacteristics: v.specialCharacteristics ?? null,
    numberOfSeats: v.numberOfSeats ?? null,
    vehicleStatus: v.vehicleStatus ?? null,
    registeredStatus: v.registeredStatus ?? null,
    registeredStatusLabel: v.registeredStatusLabel ?? null,
  }));
}
