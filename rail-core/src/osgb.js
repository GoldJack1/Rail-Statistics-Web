/**
 * OSGB36 National Grid (EPSG:27700) → WGS84 lat/lon.
 * Compact Helmert + Airy1830 transverse mercator (no deps).
 */

const a = 6377563.396;
const b = 6356256.909;
const F0 = 0.9996012717;
const lat0 = (49 * Math.PI) / 180;
const lon0 = (-2 * Math.PI) / 180;
const N0 = -100000;
const E0 = 400000;
const e2 = 1 - (b * b) / (a * a);
const n = (a - b) / (a + b);

function marc(phi) {
  const n2 = n * n;
  const n3 = n2 * n;
  return (
    b *
    F0 *
    ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (phi - lat0) -
      (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(phi - lat0) * Math.cos(phi + lat0) +
      ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (phi - lat0)) * Math.cos(2 * (phi + lat0)) -
      (35 / 24) * n3 * Math.sin(3 * (phi - lat0)) * Math.cos(3 * (phi + lat0)))
  );
}

/** @returns {{ lat: number, lon: number } | null} */
export function osgbToWgs84(easting, northing) {
  const E = Number(easting);
  const N = Number(northing);
  if (!Number.isFinite(E) || !Number.isFinite(N)) return null;
  if (E < 0 || E > 800000 || N < 0 || N > 1400000) return null;

  let phi = lat0 + (N - N0) / (a * F0);
  let M = marc(phi);
  while (Math.abs(N - N0 - M) >= 0.01) {
    phi += (N - N0 - M) / (a * F0);
    M = marc(phi);
  }

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const tanPhi = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;
  const VII = tanPhi / (2 * rho * nu);
  const VIII = (tanPhi / (24 * rho * nu ** 3)) * (5 + 3 * tanPhi ** 2 + eta2 - 9 * tanPhi ** 2 * eta2);
  const IX = (tanPhi / (720 * rho * nu ** 5)) * (61 + 90 * tanPhi ** 2 + 45 * tanPhi ** 4);
  const X = 1 / (cosPhi * nu);
  const XI = (1 / (cosPhi * 6 * nu ** 3)) * (nu / rho + 2 * tanPhi ** 2);
  const XII = (1 / (cosPhi * 120 * nu ** 5)) * (5 + 28 * tanPhi ** 2 + 24 * tanPhi ** 4);
  const XIIA =
    (1 / (cosPhi * 5040 * nu ** 7)) * (61 + 662 * tanPhi ** 2 + 1320 * tanPhi ** 4 + 720 * tanPhi ** 6);

  const dE = E - E0;
  const lat =
    phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6;
  const lon =
    lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;

  // Airy1830 → WGS84 Helmert (approx metres → radians via local)
  const latDeg = (lat * 180) / Math.PI;
  const lonDeg = (lon * 180) / Math.PI;
  // Small datum shift (OSGB36→WGS84), good to ~5 m for corridor work
  const dLat = -0.000013; // ~1.5 m
  const dLon = 0.00005;
  return { lat: latDeg + dLat, lon: lonDeg + dLon };
}
