/**
 * Which train drawing (if any) a service gets. Pure functions over the index that
 * scripts/build-drawings.mjs writes, so the lookup is a few Map reads however many liveries there are.
 *
 * Index shape: { version, drawings: [{ id, class, sub, operator, toc: [..], units: [..], classes: [..],
 * width, height }] } where `id` is "<class>/<sub>/<operator>/<livery>" (also the URL path without extension).
 */
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** "68019-68032" or "68019" to the list of numbers. Throws on a bad or oversized range. */
export function expandUnitRange(spec) {
  const s = String(spec).trim();
  const m = /^([A-Z0-9]*?)(\d+)-(?:\1)?(\d+)$/i.exec(s);
  if (!m) {
    if (!/^[A-Z0-9]{3,10}$/i.test(s)) throw new Error(`bad unit "${s}"`);
    return [s.toUpperCase()];
  }
  const [, prefix, a, b] = m;
  const from = Number(a);
  const to = Number(b);
  if (to < from || to - from > 2000) throw new Error(`bad range "${s}"`);
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix.toUpperCase()}${String(from + i).padStart(a.length, "0")}`);
}

/** Leading class digits of a unit or loco number: 68019 gives 68, 139001 gives 139. */
export function classOfUnitNumber(id) {
  const s = String(id || "").trim();
  if (/^\d{6}$/.test(s)) return s.slice(0, 3);
  if (/^\d{5}$/.test(s)) return s.slice(0, 2);
  return null;
}

export function buildLookup(index) {
  const byUnit = new Map(); // unit -> drawing
  const byClassToc = new Map(); // `${class}|${toc}` -> drawing
  for (const d of index?.drawings || []) {
    const tocs = d.toc?.length ? d.toc : [""];
    for (const unit of d.units || []) for (const toc of tocs) byUnit.set(`${unit}|${toc}`, d);
    for (const cls of d.classes || []) for (const toc of tocs) byClassToc.set(`${cls}|${toc}`, d);
  }
  return { version: index?.version || null, byUnit, byClassToc };
}

/**
 * The drawings for a train: one per distinct match across its unit and locomotive numbers, in order.
 * An explicit unit number beats the operator's class-wide livery. Nothing matched gives [].
 */
export function resolveDrawings(lookup, toc, candidateIds) {
  if (!lookup) return [];
  const t = String(toc || "").toUpperCase();
  const out = [];
  const seen = new Set();
  for (const raw of candidateIds || []) {
    const id = String(raw || "").trim().toUpperCase();
    if (!id) continue;
    const cls = classOfUnitNumber(id);
    const d = lookup.byUnit.get(`${id}|${t}`) || (cls ? lookup.byClassToc.get(`${cls}|${t}`) : null);
    if (!d || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({ id: d.id, width: d.width, height: d.height, v: lookup.version });
  }
  return out;
}

/**
 * Unit ids plus every vehicle id (locomotive numbers live there) in a consist document.
 * `onlyUnits` limits it to the units on the train at one call, so a detached portion is not drawn.
 */
export function drawingCandidateIds(consist, onlyUnits = null) {
  const ids = [];
  const keep = onlyUnits?.length ? new Set(onlyUnits.map(String)) : null;
  for (const a of consist?.allocations || []) {
    for (const g of a.resourceGroups || []) {
      if (keep && !keep.has(String(g?.unitId))) continue;
      if (g?.unitId) ids.push(String(g.unitId));
      for (const v of g?.vehicles || []) if (v?.vehicleId) ids.push(String(v.vehicleId));
    }
  }
  return [...new Set(ids)];
}

let cache = { dir: null, mtime: 0, lookup: null };

/** Lookup for the deployed index, reloaded when index.json changes. Null when there is none. */
export function loadDrawingLookup(dir = resolve(process.env.DRAWINGS_DIR || join(process.cwd(), "assets", "train-drawings"))) {
  const file = join(dir, "index.json");
  try {
    const mtime = statSync(file).mtimeMs;
    if (cache.dir === dir && cache.mtime === mtime) return cache.lookup;
    cache = { dir, mtime, lookup: buildLookup(JSON.parse(readFileSync(file, "utf8"))) };
    return cache.lookup;
  } catch {
    return null;
  }
}

/** Drawings for a train from its toc and consist (a stored row's parsed json, or a consist document). */
export function drawingsForTrain(toc, consist, { onlyUnits = null, lookup = loadDrawingLookup() } = {}) {
  return resolveDrawings(lookup, toc, drawingCandidateIds(consist, onlyUnits));
}
