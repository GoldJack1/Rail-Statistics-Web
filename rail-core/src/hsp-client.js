const HSP_ORIGIN = () => process.env.NRDP_HSP_ORIGIN ?? "https://hsp-prod.rockshore.net";

function authHeader() {
  const user = process.env.NRDP_HSP_USER ?? "";
  const pass = process.env.NRDP_HSP_PASSWORD ?? "";
  if (!user || !pass) throw new Error("NRDP_HSP_USER/PASSWORD not set");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function hspPost(path, body) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${HSP_ORIGIN().replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: authHeader(), "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const err = new Error(`HSP ${path} ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    lastErr = err;
    if (res.status !== 429 && res.status !== 503) throw err;
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
  }
  throw lastErr;
}

/** Overlapping token bucket: start at most `perSec` HSP calls per second, up to `concurrency` in flight. */
export function createHspLimiter(opts = {}) {
  const perSec = Math.max(0.5, Number(opts.perSec ?? process.env.HSP_DETAILS_PER_SEC ?? 5));
  const concurrency = Math.max(1, Math.min(16, Number(opts.concurrency ?? process.env.HSP_CONCURRENCY ?? 6)));
  const gapMs = Math.round(1000 / perSec);
  let nextAt = 0;
  async function acquire() {
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + gapMs;
    if (at > now) await sleep(at - now);
  }
  return { perSec, concurrency, acquire };
}

export async function mapHspLimited(items, fn, opts = {}) {
  const { concurrency, acquire } = createHspLimiter(opts);
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      await acquire();
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return out;
}

export function weekdayKind(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0) return "SUNDAY";
  if (dow === 6) return "SATURDAY";
  return "WEEKDAY";
}

export async function hspServiceMetrics(opts) {
  return hspPost("/api/v1/serviceMetrics", {
    from_loc: opts.from,
    to_loc: opts.to,
    from_time: opts.fromTime,
    to_time: opts.toTime,
    from_date: opts.ymd,
    to_date: opts.ymd,
    days: opts.days || weekdayKind(opts.ymd),
  });
}

export async function hspServiceDetails(rid) {
  return hspPost("/api/v1/serviceDetails", { rid: String(rid) });
}

export function ridsFromMetrics(metrics) {
  const out = [];
  for (const svc of metrics?.Services || []) {
    const m = svc.serviceAttributesMetrics || {};
    for (const rid of m.rids || []) out.push(String(rid));
  }
  return [...new Set(out)];
}
