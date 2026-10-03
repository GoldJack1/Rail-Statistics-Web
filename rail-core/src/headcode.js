/** Passenger trains: 1xxx / 2xxx / 9xxx. ECS, parcels, and freight (0, 3–8) are ignored for splits. */
export function isPassengerHeadcode(trainId) {
  const ch = String(trainId || "").trim().charAt(0);
  if (!ch) return true;
  return ch === "1" || ch === "2" || ch === "9";
}
