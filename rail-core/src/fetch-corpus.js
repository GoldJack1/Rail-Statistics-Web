#!/usr/bin/env node
/**
 * Load RDM NLC (TSDBData / NLCTiplocCode) into catalog.sqlite.
 * Falls back to an on-disk CORPUS JSON only if no NLC file is present.
 */
import "./load-env.js";
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCatalog } from "./db.js";
import { importCorpusRows, importTopsByStanox, parseCorpusPayload, parseTopsCsv } from "./import-corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TT_DIR = process.env.TT_DIR ?? join(ROOT, "tt");
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data");
const SEED_DIR = join(ROOT, "data-seed");

function filesIn(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => re.test(n))
    .map((n) => join(dir, n));
}

export function findNlcFile() {
  if (process.env.NLC_PATH && existsSync(process.env.NLC_PATH)) return process.env.NLC_PATH;
  const listed = [...filesIn(TT_DIR, /^NLC.*\.xml(\.gz)?$/i), ...filesIn(SEED_DIR, /^NLC.*\.xml(\.gz)?$/i)].sort();
  return listed.length ? listed[listed.length - 1] : null;
}

export function findTopsFile() {
  if (process.env.TOPS_PATH && existsSync(process.env.TOPS_PATH)) return process.env.TOPS_PATH;
  const listed = [
    ...filesIn(TT_DIR, /^tops-location.*\.csv$/i),
    ...filesIn(SEED_DIR, /^tops-location.*\.csv$/i),
  ].sort();
  return listed.length ? listed[listed.length - 1] : null;
}

export function fetchCorpusFile() {
  mkdirSync(TT_DIR, { recursive: true });
  const existing = findNlcFile();
  if (existing) {
    console.log("using NLC file", existing);
    return existing;
  }
  const dest = process.env.CORPUS_PATH || join(TT_DIR, "corpus.json.gz");
  if (existsSync(dest)) {
    console.log("CORPUS using existing file", dest);
    return dest;
  }
  console.error("No NLC*.xml.gz found in tt/ or data-seed/. Put the RDM NLC extract there (NLC_PATH=...).");
  return null;
}

export function importFetchedCorpus(path) {
  if (!path || !existsSync(path)) return 0;
  const cat = openCatalog(DATA_DIR);
  const n = importCorpusRows(cat, parseCorpusPayload(readFileSync(path)));
  const tops = findTopsFile();
  let topsN = 0;
  if (tops) {
    topsN = importTopsByStanox(cat, parseTopsCsv(readFileSync(tops, "utf8")));
    console.log("filled from TOPS", topsN, "from", tops);
  }
  cat.close();
  console.log("imported location rows", n, "from", path);
  return n;
}

const runningAsCli = process.argv[1]?.replace(/\\/g, "/").endsWith("/fetch-corpus.js");
if (runningAsCli) {
  const given = process.argv[2];
  if (given && existsSync(given)) {
    mkdirSync(TT_DIR, { recursive: true });
    const dest = join(TT_DIR, given.replace(/^.*\//, ""));
    if (given !== dest) copyFileSync(given, dest);
    importFetchedCorpus(dest);
  } else {
    const path = fetchCorpusFile();
    if (!path) process.exit(1);
    importFetchedCorpus(path);
  }
}
