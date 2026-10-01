const HSP_ORIGIN = () => process.env.NRDP_HSP_ORIGIN ?? "https://hsp-prod.rockshore.net";

function authHeader() {
  const user = process.env.NRDP_HSP_USER ?? "";
  const pass = process.env.NRDP_HSP_PASSWORD ?? "";
  if (!user || !pass) throw new Error("NRDP_HSP_USER/PASSWORD not set");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export async function hspPost(path, body) {
  const res = await fetch(`${HSP_ORIGIN().replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`HSP ${path} ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
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
