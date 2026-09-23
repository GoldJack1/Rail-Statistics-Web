/**
 * Darwin activity-code decoder.
 *
 * The `activity` (CIF "act") string on a calling-pattern stop is a fixed-width
 * character grid where each pair encodes one operation. Common pairs:
 *   TB   Train begins
 *   TF   Train finishes
 *   T    Stops to set down and pick up
 *   T X  Set down only ("X" = exchange of guards / restricted)
 *   T D  Set down only
 *   T U  Pick up only
 *   T R  Request stop
 *   OPRM Operational stop, no boarding
 *   OPSL Stops for railway personnel only
 *   RM   Reverses
 *   TS   Stops for tablet exchange
 *
 * Multiple codes may appear on one stop (e.g. "T XR" = set-down only AND a
 * request stop). We tokenise on whitespace AND known leading codes so a TOC's
 * stray formatting can't break the badge logic.
 *
 * `important: false` codes are suppressed in the UI by default; we still
 * return them so callers can be exhaustive if they want.
 */

export type DarwinActivity = {
  code: string;
  label: string;
  important: boolean;
};

const TABLE: Record<string, { label: string; important: boolean }> = {
  // Trivially implied by the OR/DT marker; suppress in UI.
  TB:   { label: 'Train begins',     important: false },
  TF:   { label: 'Train finishes',   important: false },
  T:    { label: 'Stop',             important: false },
  // Material to passenger plans:
  TX:   { label: 'Set down only',    important: true },
  TD:   { label: 'Set down only',    important: true },
  TU:   { label: 'Pick-up only',     important: true },
  TR:   { label: 'Request stop',     important: true },
  RM:   { label: 'Reverses here',    important: true },
  RR:   { label: 'Reverses here',    important: true },
  TS:   { label: 'Tablet exchange',  important: true },
  OPRM: { label: 'Op stop',          important: true },
  OPSL: { label: 'Staff only',       important: true },
  // Other CIF codes occasionally seen; informational.
  AE:   { label: 'Attach/detach',    important: true },
  BL:   { label: 'Banking loco',     important: true },
  PR:   { label: 'Propelling',       important: true },
};

/**
 * Decode a Darwin activity string into a list of activity tokens.
 * Empty / null input returns `[]`. Unknown codes are returned as
 * `{ code, label: code, important: false }` so callers can opt-in to
 * showing them.
 */
export function decodeActivity(raw: string | null | undefined): DarwinActivity[] {
  if (!raw) return [];
  const out: DarwinActivity[] = [];
  // Normalise whitespace then walk the table looking for known prefixes,
  // stripping each match. Falls back to a single token of the leftover.
  const s = String(raw).toUpperCase().trim();
  // CIF activity strings are pairs of characters separated by whitespace
  // when written verbose, but the PPv16 feed often emits a packed form.
  // Normalise both: split on whitespace first, then walk each chunk for
  // multiple pairs.
  const chunks = s.split(/\s+/).filter(Boolean);
  for (const chunk of chunks) {
    let rest = chunk;
    while (rest.length > 0) {
      // Try the longest known code first (4 → 2 chars).
      let matched = false;
      for (const len of [4, 2]) {
        if (rest.length < len) continue;
        const head = rest.slice(0, len);
        if (TABLE[head]) {
          out.push({ code: head, ...TABLE[head] });
          rest = rest.slice(len);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Unknown 1- or 2-char code; surface it as an unknown token.
        const head = rest.slice(0, 2);
        out.push({ code: head, label: head, important: false });
        rest = rest.slice(2);
      }
    }
  }
  return out;
}

/**
 * Convenience: only the codes a typical UI wants to badge.
 */
export function importantActivities(raw: string | null | undefined): DarwinActivity[] {
  return decodeActivity(raw).filter((a) => a.important);
}
