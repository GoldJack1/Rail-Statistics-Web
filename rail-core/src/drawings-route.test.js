import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDrawingPath, serveDrawing } from "./drawings-route.js";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let root;
let dir;
let server;
let base;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>';

before(async () => {
  root = mkdtempSync(join(tmpdir(), "drawings-"));
  dir = join(root, "train-svgs");
  mkdirSync(join(dir, "80x", "800", "gwr"), { recursive: true });
  writeFileSync(join(dir, "index.json"), JSON.stringify({ version: "t1", classes: {} }));
  writeFileSync(join(dir, "80x", "800", "gwr", "END5.svg"), SVG);
  writeFileSync(join(dir, "80x", "800", "gwr", "END5.png"), Buffer.from(PNG_B64, "base64"));
  writeFileSync(join(root, "secret.svg"), "SECRET"); // sibling of the drawings dir
  writeFileSync(join(root, "secret.json"), "SECRET");
  server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;
    if (!serveDrawing(req, res, pathname, { dir })) {
      res.writeHead(418);
      res.end("not a drawings path");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

test("serves the index as cacheable JSON with an ETag", async () => {
  const res = await fetch(`${base}/api/drawings/index.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/json/);
  assert.match(res.headers.get("cache-control"), /max-age=300/);
  assert.ok(res.headers.get("etag"));
  assert.equal((await res.json()).version, "t1");
});

test("serves a car SVG with the right type, long cache and locked-down CSP", async () => {
  const res = await fetch(`${base}/api/drawings/80x/800/gwr/END5.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(res.headers.get("cache-control"), /s-maxage=604800/);
  assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await res.text(), SVG);
});

test("a version query string is ignored by the file lookup", async () => {
  const res = await fetch(`${base}/api/drawings/80x/800/gwr/END5.svg?v=abc123`);
  assert.equal(res.status, 200);
});

test("If-None-Match returns 304", async () => {
  const first = await fetch(`${base}/api/drawings/index.json`);
  const res = await fetch(`${base}/api/drawings/index.json`, { headers: { "if-none-match": first.headers.get("etag") } });
  assert.equal(res.status, 304);
});

test("HEAD returns headers and no body", async () => {
  const res = await fetch(`${base}/api/drawings/80x/800/gwr/END5.svg`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), String(SVG.length));
  assert.equal(await res.text(), "");
});

test("only GET and HEAD are allowed", async () => {
  const res = await fetch(`${base}/api/drawings/index.json`, { method: "POST", body: "{}" });
  assert.equal(res.status, 405);
});

test("missing files are 404", async () => {
  assert.equal((await fetch(`${base}/api/drawings/80x/800/gwr/NOPE.svg`)).status, 404);
  assert.equal((await fetch(`${base}/api/drawings/nothing.json`)).status, 404);
});

test("paths cannot leave the drawings directory", async () => {
  const attempts = [
    "/api/drawings/../secret.svg",
    "/api/drawings/%2e%2e/secret.json",
    "/api/drawings/80x/%2e%2e/%2e%2e/secret.svg",
    "/api/drawings/80x/800/gwr/..%2f..%2f..%2fsecret.svg",
    "/api/drawings/80x/800/gwr/.hidden.svg",
    "/api/drawings/80x/800/gwr/END5.svg/extra",
    "/api/drawings/80x/800/END5.svg", // wrong depth
    "/api/drawings/80x/800/gwr/END5.gif", // wrong type
    "/api/drawings/index.json/",
    "/api/drawings/",
    "/api/drawings",
  ];
  for (const path of attempts) {
    const res = await fetch(`${base}${path}`);
    // 418 = the URL parser collapsed ../ so the request is no longer under /api/drawings (not served).
    assert.ok([404, 405, 418].includes(res.status), `${path} gave ${res.status}`);
    assert.ok(!(await res.text()).includes("SECRET"), `${path} leaked the secret`);
  }
});

test("resolveDrawingPath only accepts the index or a four-part svg path", () => {
  const d = "/srv/drawings";
  assert.equal(resolveDrawingPath("/api/drawings/index.json", d), "/srv/drawings/index.json");
  assert.equal(resolveDrawingPath("/api/drawings/a/b/c/D.svg", d), "/srv/drawings/a/b/c/D.svg");
  assert.equal(resolveDrawingPath("/api/drawings/a/b/c/D.svg/x", d), null);
  assert.equal(resolveDrawingPath("/api/other/index.json", d), null);
  assert.equal(resolveDrawingPath("/api/drawings/a/../c/d/E.svg", d), null);
  assert.equal(resolveDrawingPath("/api/drawings/a/b\\c/D.svg", d), null); // backslash in a segment
  assert.equal(resolveDrawingPath("/api/drawings/a/b%2Fc/D.svg", d), null); // encoded slash
});

test("paths outside /api/drawings are not handled", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 418);
});

test("serves the pre-rendered PNG of a car", async () => {
  const res = await fetch(`${base}/api/drawings/80x/800/gwr/END5.png?v=1`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control"), /s-maxage=604800/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
});

test("other image types are not served", async () => {
  assert.equal((await fetch(`${base}/api/drawings/80x/800/gwr/END5.jpg`)).status, 404);
  assert.equal((await fetch(`${base}/api/drawings/80x/800/gwr/END5.png.svg`)).status, 404);
});
