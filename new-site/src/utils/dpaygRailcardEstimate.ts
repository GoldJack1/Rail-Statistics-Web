/**
 * Estimate a railcard fare from a standard fare (pence).
 *
 * Rule (aligned with iOS / Firestore data):
 * 1. Take ⅔ of standard (rounded)
 * 2. Snap ones digit: 1–4 → 0, 6–8 → 5, 9 → next 10
 * 3. Exact £x.60 → £x.55
 */
export function estimateRailcardPence(standardPence: number): number {
  if (!Number.isFinite(standardPence) || standardPence <= 0) return 0

  let p = Math.round((standardPence * 2) / 3)
  const ones = p % 10
  if (ones >= 1 && ones <= 4) {
    p = p - ones
  } else if (ones >= 6 && ones <= 8) {
    p = p - ones + 5
  } else if (ones === 9) {
    p = p - ones + 10
  }
  if (p % 100 === 60) {
    p = p - 5
  }
  return p
}
