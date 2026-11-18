/**
 * Train drawings for every client (web, iOS): one image per whole unit, built by scripts/build-drawings.mjs
 * and served from DRAWINGS_DIR (default ./assets/train-drawings) so art updates on the server alone.
 *
 *   GET /api/drawings/index.json                              all liveries and the version
 *   GET /api/drawings/<class>/<sub>/<operator>/<livery>.svg   e.g. 67/mk4/tfw/exlner.svg
 *   GET /api/drawings/<class>/<sub>/<operator>/<livery>.png   the same at 3x (120px high) for iOS
 *
 * Public and read-only. Anything outside that shape is a 404, so a path can never leave the directory.
 * Clients append `?v=<version>` (from the payload) so an update reaches everyone straight away.
 */
import { createReadStream, statSync } from "node:fs";
import { join, resolve } from "node:path";

const PREFIX = "/api/drawings";
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const INDEX_CACHE = "public, max-age=300, s-maxage=300, stale-while-revalidate=3600";
const CAR_CACHE = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

export function drawingsDir() {
  return resolve(process.env.DRAWINGS_DIR || join(process.cwd(), "assets", "train-drawings"));
}

/** `/api/drawings/<rest>` to an absolute file path under `dir`, or null if it is not a drawing path. */
export function resolveDrawingPath(pathname, dir) {
  if (!pathname.startsWith(`${PREFIX}/`)) return null;
  const parts = pathname.slice(PREFIX.length + 1).split("/");
  const clean = [];
  for (const raw of parts) {
    let seg;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!SEGMENT.test(seg) || seg.includes("..")) return null;
    clean.push(seg);
  }
  const isIndex = clean.length === 1 && clean[0] === "index.json";
  const isCar = clean.length === 4 && /\.(svg|png)$/.test(clean[3]) && clean[3].length > 4;
  if (!isIndex && !isCar) return null;
  const root = resolve(dir);
  const file = resolve(root, ...clean);
  return file.startsWith(root + "/") || file.startsWith(root + "\\") ? file : null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(body);
}

/** Handles a drawings request. Returns false when the path is not under /api/drawings. */
export function serveDrawing(req, res, pathname, { dir = drawingsDir() } = {}) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, JSON.stringify({ error: "method_not_allowed" }), { allow: "GET, HEAD" });
    return true;
  }
  const file = resolveDrawingPath(pathname, dir);
  let stat = null;
  if (file) {
    try {
      stat = statSync(file);
    } catch {
      stat = null;
    }
  }
  if (!file || !stat || !stat.isFile()) {
    send(res, 404, JSON.stringify({ error: "not_found" }));
    return true;
  }
  const isIndex = file.endsWith("index.json");
  const isPng = file.endsWith(".png");
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": isIndex ? "application/json; charset=utf-8" : isPng ? "image/png" : "image/svg+xml; charset=utf-8",
    "cache-control": isIndex ? INDEX_CACHE : CAR_CACHE,
    etag,
    "last-modified": stat.mtime.toUTCString(),
    "x-content-type-options": "nosniff",
    // An SVG opened directly (not via <img>) must not run anything.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
  return true;
}
