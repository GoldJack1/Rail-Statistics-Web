/** NROD TRAIN_MVT frames are a JSON array of { header, body }. */
export function trustMessages(raw) {
  if (raw == null) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    parsed = JSON.parse(s);
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed.header || parsed.body) return [parsed];
  if (Array.isArray(parsed.messages)) return parsed.messages;
  return [];
}
