#!/usr/bin/env node
/**
 * Build the train drawings for the VPS from assets/train-drawings-src:
 *   <class>/<sub-class>/<operator>/_rules.json + the SVGs it names
 * Validates every rule file, checks each SVG is 40 high, copies the SVG, renders a 3x PNG (120px high) for
 * iOS, and writes index.json. Output goes to assets/train-drawings-build; upload with deploy-drawings.sh.
 *
 *   node rail-core/scripts/build-drawings.mjs [srcDir] [outDir]
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandUnitRange } from "../src/drawings-index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const SRC = resolve(process.argv[2] || join(root, "assets", "train-drawings-src"));
const OUT = resolve(process.argv[3] || join(root, "assets", "train-drawings-build"));
const HEIGHT = 40;
const PNG_SCALE = 3;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// sharp lives in the site's node_modules; this script only runs on the Mac.
const require = createRequire(join(root, "..", "new-site", "package.json"));
const sharp = require("sharp");

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const errors = [];
const fail = (msg) => errors.push(msg);

const drawings = [];
const claimed = new Map(); // `${toc}|${unit}` -> id
const claimedClass = new Map(); // `${toc}|${class}` -> id

for (const cls of dirs(SRC)) for (const sub of dirs(join(SRC, cls))) for (const operator of dirs(join(SRC, cls, sub))) {
  const folder = join(SRC, cls, sub, operator);
  const where = `${cls}/${sub}/${operator}`;
  if (![cls, sub, operator].every((s) => SEGMENT.test(s))) { fail(`${where}: folder names must be letters, digits, . _ -`); continue; }
  const rulesPath = join(folder, "_rules.json");
  if (!existsSync(rulesPath)) { fail(`${where}: missing _rules.json`); continue; }
  let rules;
  try { rules = JSON.parse(readFileSync(rulesPath, "utf8")); } catch (e) { fail(`${where}: _rules.json is not valid JSON`); continue; }
  const toc = (rules.toc || []).map((t) => String(t).toUpperCase());
  if (!toc.length) fail(`${where}: "toc" is required`);
  for (const [livery, spec] of Object.entries(rules.liveries || {})) {
    const id = `${where}/${livery}`;
    if (!SEGMENT.test(livery)) { fail(`${id}: bad livery name`); continue; }
    const file = join(folder, String(spec.file || ""));
    if (!spec.file || !existsSync(file)) { fail(`${id}: file "${spec.file}" not found`); continue; }
    const svg = readFileSync(file);
    const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg.toString("utf8", 0, 4000));
    if (!vb) { fail(`${id}: SVG has no viewBox`); continue; }
    const width = Number(vb[1]);
    if (Math.abs(Number(vb[2]) - HEIGHT) > 0.01) fail(`${id}: SVG is ${vb[2]} high, expected ${HEIGHT}`);
    let units = [];
    try { units = [...new Set((spec.units || []).flatMap(expandUnitRange))]; } catch (e) { fail(`${id}: ${e.message}`); continue; }
    const classes = (spec.classes || []).map(String);
    if (!units.length && !classes.length) fail(`${id}: needs "units" or "classes"`);
    for (const t of toc) {
      for (const u of units) {
        const k = `${t}|${u}`;
        if (claimed.has(k)) fail(`${id}: ${u} (${t}) is already used by ${claimed.get(k)}`);
        else claimed.set(k, id);
      }
      for (const c of classes) {
        const k = `${t}|${c}`;
        if (claimedClass.has(k)) fail(`${id}: class ${c} (${t}) is already used by ${claimedClass.get(k)}`);
        else claimedClass.set(k, id);
      }
    }
    drawings.push({ id, class: cls, sub, operator, name: rules.name || null, toc, units, classes, width, height: HEIGHT, file });
  }
}

if (errors.length) {
  console.error(`${errors.length} problem(s):\n - ${errors.join("\n - ")}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
const hash = createHash("sha1");
for (const d of drawings) {
  const dest = join(OUT, d.id);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(d.file, `${dest}.svg`);
  const svg = readFileSync(d.file);
  hash.update(d.id).update(svg).update(JSON.stringify([d.toc, d.units, d.classes]));
  const png = await sharp(svg, { density: 72 * PNG_SCALE }).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(`${dest}.png`, png);
  console.log(`${d.id}  ${d.width}x${d.height}  svg ${(svg.length / 1024).toFixed(0)}KB  png ${(png.length / 1024).toFixed(0)}KB`);
}
const index = {
  version: hash.digest("hex").slice(0, 10),
  pngScale: PNG_SCALE,
  drawings: drawings.map(({ file, ...rest }) => rest),
};
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
console.log(`index version ${index.version}, ${drawings.length} drawings -> ${OUT}`);
