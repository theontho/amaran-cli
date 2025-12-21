/**
 * Simple approximations and curves for daylight simulation.
 */

/**
 * CIE daylight locus approximation.
 * @param x Progress through the day (0 to 1)
 */
export function cieDaylightCurve(x: number): number {
  return Math.sin(Math.PI * x) ** 0.8;
}

/**
 * Simple sun altitude-based approximation.
 * @param x Progress through the day (0 to 1)
 */
export function sunAltitudeCurve(x: number): number {
  return 1 - Math.cos(Math.PI * x);
}

/**
 * Perez daylight model approximation.
 * @param x Progress through the day (0 to 1)
 */
export function perezDaylightCurve(x: number): number {
  const zenithAngle = Math.PI * (0.5 - Math.abs(x - 0.5));
  const scattering = Math.exp(-2.0 * Math.max(0, Math.cos(zenithAngle)));
  return Math.sin(Math.PI * x) ** 0.6 * (1 - 0.2 * scattering);
}
