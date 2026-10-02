/** CIF BS date-run fields (1-based 10–28). */

export function cifYymmdd(raw) {
  const s = String(raw || "").replace(/\D/g, "");
  if (s.length < 6) return null;
  const yy = Number(s.slice(0, 2));
  const year = yy >= 60 ? 1900 + yy : 2000 + yy;
  return `${year}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}

export function cifWeekdayIndex(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

export function cifBsRunsOn(line, ymd) {
  if (!line || line.slice(0, 2) !== "BS" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd || "")) return false;
  const txn = line.slice(2, 3).toUpperCase();
  if (txn === "D") return false;
  const stp = (line[79] || "").toUpperCase();
  if (stp === "C") return false;
  const start = cifYymmdd(line.slice(9, 15));
  const end = cifYymmdd(line.slice(15, 21));
  const days = line.slice(21, 28);
  if (start && ymd < start) return false;
  if (end && ymd > end) return false;
  if (days.length >= 7 && days[cifWeekdayIndex(ymd)] === "0") return false;
  return true;
}
