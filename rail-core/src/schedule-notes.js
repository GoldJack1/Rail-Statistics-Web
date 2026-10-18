/** Labels for the service overview and for a pathing change along the run. */

const CATEGORY = {
  OO: "Ordinary Passenger",
  OU: "Unadvertised Ordinary Passenger",
  OS: "Staff Train",
  OW: "Mixed",
  OL: "London Underground/Metro Service",
  XC: "Channel Tunnel",
  XD: "Sleeper (Europe Night Services)",
  XI: "International",
  XR: "Motorail",
  XX: "Express Passenger",
  XZ: "Sleeper (Domestic)",
  BR: "Bus Replacement",
  BS: "Bus",
  EE: "Empty Coaching Stock",
  EL: "ECS, London Underground/Metro",
  ES: "Empty Coaching Stock",
  JJ: "Postal",
  PM: "Post Office Controlled Parcels",
  PP: "Parcels",
  PV: "Empty NPCCS",
  DD: "Departmental",
  DH: "Civil Engineer",
  DI: "Mechanical & Electrical Engineer",
  DQ: "Civil Engineer",
  DT: "Mechanical & Electrical Engineer",
  DY: "Signal & Telecomms Engineer",
  ZB: "Light Locomotive",
  ZZ: "Light Locomotive",
};

const CLASS_GROUPS = {
  150: "150/153/155/156",
  153: "150/153/155/156",
  155: "150/153/155/156",
  156: "150/153/155/156",
  158: "158/159",
  159: "158/159",
  165: "165/166",
  166: "165/166",
  170: "170/171",
  171: "170/171",
  220: "220/221",
  221: "220/221",
  375: "375/377/379",
  377: "375/377/379",
  379: "375/377/379",
  800: "80x",
  801: "80x",
  802: "80x",
  803: "80x",
  805: "80x",
  807: "80x",
};

const DAY = ["M", "T", "W", "Th", "F", "Sa", "Su"];

export function daysRunLabel(daysRun) {
  const days = String(daysRun || "");
  if (days.length < 7) return null;
  if (days === "1111100") return "SX";
  if (days === "0000010") return "SO";
  if (days === "0000001") return "SuO";
  if (days === "1111111") return "Daily";
  const on = DAY.filter((_, i) => days[i] === "1");
  if (!on.length) return null;
  if (on.length === 1 && on[0] === "Su") return "SuO";
  return on.join("");
}

export function categoryLabel(code) {
  const key = String(code || "").trim().toUpperCase();
  return CATEGORY[key] || null;
}

export function seatingLabel(code) {
  const key = String(code || "").trim().toUpperCase();
  if (key === "S") return "Standard class only seating";
  if (key === "F") return "First class only seating";
  if (key === "B") return "First & Standard class seating";
  return null;
}

export function reservationsLabel(code) {
  const key = String(code || "").trim().toUpperCase();
  if (key === "A" || key === "S") return "Reservations available";
  if (key === "E" || key === "R") return "Reservations compulsory";
  if (key === "P") return "Reservations recommended";
  return null;
}

export function formatRuns(daysRun, runsFrom, runsTo) {
  const days = daysRunLabel(daysRun);
  const from = formatCifDate(runsFrom);
  const to = formatCifDate(runsTo);
  if (days && from && to) return `${days} - ${from} to ${to}`;
  if (from && to) return `${from} to ${to}`;
  return days;
}

function formatCifDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function classList(timingLoad) {
  const raw = String(timingLoad || "").trim().toUpperCase();
  if (!raw) return "";
  const digits = raw.replace(/^0+/, "") || raw;
  if (CLASS_GROUPS[digits]) return CLASS_GROUPS[digits];
  return /^\d{3}$/.test(digits) ? digits : "";
}

function mphOf(speed) {
  const n = Number(String(speed || "").trim());
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

/** "Pathed as Class 150/153/155/156 DMU at 75mph". EMU uses RTT's electric wording. */
export function pathedAsLabel({ powerType, timingLoad, speed } = {}) {
  const power = String(powerType || "").trim().toUpperCase();
  const classes = classList(timingLoad);
  const mph = mphOf(speed);
  if (!power && !classes) return null;
  const traction = power === "EMU" ? "on electric" : power;
  const classPart = classes ? `Class ${classes}` : "";
  const body = ["Pathed as", classPart, traction].filter(Boolean).join(" ");
  return mph ? `${body} at ${mph}mph` : body;
}

/** CIF allowances are half-minutes. 2 is one minute. */
export function allowanceText(kind, raw) {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  const minutes = n / 2;
  const amount = minutes === 0.5 ? "½ minute" : Number.isInteger(minutes)
    ? `${minutes} minute${minutes === 1 ? "" : "s"}`
    : `${minutes} minutes`;
  return `${kind} allowance ${amount}`;
}

export function allowanceNotes(row) {
  return [
    allowanceText("Engineering", row?.engineering || row?.engineeringAllowance),
    allowanceText("Pathing", row?.pathing || row?.pathingAllowance),
    allowanceText("Performance", row?.performance || row?.performanceAllowance),
  ].filter(Boolean);
}

function sameTpl(a, b) {
  return String(a || "").toUpperCase() === String(b || "").toUpperCase();
}

/**
 * Attach the opening pathing sentence, a new sentence where the timing load
 * changes, and any allowance booked at that location.
 */
export function annotateStops(stops, profile, base) {
  const rows = (stops || []).map((stop) => ({ ...stop }));
  const allowances = profile?.allowances || [];
  const changes = profile?.changes || [];
  let allowanceAt = 0;
  let changeAt = 0;
  let current = pathedAsLabel(base);
  for (let i = 0; i < rows.length; i++) {
    const stop = rows[i];
    if (i === 0 && current) stop.pathedAs = current;
    for (let j = allowanceAt; j < Math.min(allowances.length, allowanceAt + 8); j++) {
      if (!sameTpl(allowances[j].tiploc, stop.tpl)) continue;
      const notes = allowanceNotes(allowances[j]);
      if (notes.length) stop.allowances = notes;
      allowanceAt = j + 1;
      break;
    }
    while (changeAt < changes.length && sameTpl(changes[changeAt].tiploc, stop.tpl)) {
      const next = pathedAsLabel({
        powerType: changes[changeAt].powerType || base?.powerType,
        timingLoad: changes[changeAt].timingLoad || base?.timingLoad,
        speed: changes[changeAt].speed || base?.speed,
      });
      if (next && next !== current) {
        current = next;
        stop.pathedAs = next;
      }
      changeAt += 1;
    }
  }
  return rows;
}

export function scheduleDocument(working) {
  const profile = working?.schedule || {};
  const allowances = (working?.locs || [])
    .map((loc) => ({
      tiploc: loc.tiploc,
      pathing: loc.pathingAllowance || null,
      engineering: loc.engineeringAllowance || null,
      performance: loc.performanceAllowance || null,
    }))
    .filter((row) => row.pathing || row.engineering || row.performance);
  return {
    runsFrom: profile.runsFrom || null,
    runsTo: profile.runsTo || null,
    daysRun: profile.daysRun || null,
    bankHoliday: profile.bankHoliday || null,
    category: profile.category || working?.category || null,
    identity: profile.identity || working?.headcode || null,
    headcode: profile.headcode || null,
    tsc: profile.tsc || null,
    speed: profile.speed || null,
    operating: profile.operating || null,
    seating: profile.seating || null,
    reservations: profile.reservations || null,
    powerType: working?.powerType || null,
    timingLoad: working?.timingLoad || null,
    changes: working?.changes || [],
    allowances,
  };
}

function formatActivated(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(n));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const date = `${get("day")}/${get("month")}/${get("year")}`;
  const time = `${get("hour")}:${get("minute")}`;
  return date.includes("/") && time.includes(":") ? `${date} ${time}` : null;
}

export function publicSchedule({ svc, profile, units, trust }) {
  const stored = profile || {};
  const powerType = svc?.power_type || stored.powerType || null;
  const timingLoad = svc?.timing_load || stored.timingLoad || null;
  const speed = stored.speed || null;
  const identity = stored.identity || svc?.headcode || null;
  const stock = Array.isArray(units) ? units.filter(Boolean) : [];
  return {
    uid: svc?.uid || null,
    identity,
    tsc: stored.tsc || null,
    headcode: stored.headcode || null,
    runsFrom: stored.runsFrom || null,
    runsTo: stored.runsTo || null,
    daysRun: stored.daysRun || null,
    daysLabel: formatRuns(stored.daysRun, stored.runsFrom, stored.runsTo),
    category: stored.category || svc?.category || null,
    categoryLabel: categoryLabel(stored.category || svc?.category),
    operatingLabel: "Great Britain (Network Rail, TPS)",
    seating: stored.seating || null,
    seatingLabel: seatingLabel(stored.seating),
    reservations: stored.reservations || null,
    reservationsLabel: reservationsLabel(stored.reservations),
    trustId: trust?.train_id || null,
    activatedAt: formatActivated(trust?.activated_at),
    units: stock,
    powerType,
    timingLoad,
    speed,
    pathedAs: pathedAsLabel({ powerType, timingLoad, speed }),
  };
}
