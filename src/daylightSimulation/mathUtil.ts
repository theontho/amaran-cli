export type CctLuxMap = Record<number, number>;

/**
 * Parses a string in the format "CCT:LUX,CCT:LUX" into a map.
 * Example: "2700:8000,5600:10000" -> { 2700: 8000, 5600: 10000 }
 */
export function parseMaxLuxMap(input: string): CctLuxMap | null {
  if (!input || !input.includes(':')) return null;

  const map: CctLuxMap = {};
  const pairs = input.split(',');

  for (const pair of pairs) {
    const [cctStr, luxStr] = pair.split(':');
    const cct = parseInt(cctStr.trim(), 10);
    const lux = parseFloat(luxStr.trim());

    if (!Number.isNaN(cct) && !Number.isNaN(lux) && cct > 0 && lux > 0) {
      map[cct] = lux;
    }
  }

  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Interpolates the max lux for a specific CCT using a map of calibration points.
 * Uses linear interpolation between the two closest points.
 * Clamps to the nearest boundary if outside the range.
 */
export function interpolateMaxLux(cct: number, map: CctLuxMap | Record<string, number>): number {
  // Convert keys to numbers and sort
  const points = Object.entries(map)
    .map(([k, v]) => ({ cct: Number(k), lux: Number(v) }))
    .filter((p) => !Number.isNaN(p.cct) && !Number.isNaN(p.lux))
    .sort((a, b) => a.cct - b.cct);

  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].lux;

  // Exact match or out of bounds (low)
  if (cct <= points[0].cct) return points[0].lux;
  // Out of bounds (high)
  if (cct >= points[points.length - 1].cct) return points[points.length - 1].lux;

  // Find surrounding points
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (cct >= p1.cct && cct <= p2.cct) {
      // Linear interpolation
      // y = y1 + (x - x1) * (y2 - y1) / (x2 - x1)
      const t = (cct - p1.cct) / (p2.cct - p1.cct);
      return p1.lux + t * (p2.lux - p1.lux);
    }
  }

  return points[points.length - 1].lux; // Should be covered by high bound check, but safe fallback
}
