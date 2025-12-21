/**
 * Mathematical curve functions for Daylight Simulation
 */

/**
 * Hann window function
 * @param x Progress through the day (0 to 1)
 */
export function hannCurve(x: number): number {
  return 0.5 * (1 - Math.cos(2 * Math.PI * x));
}

/**
 * Curve with a wider plateau in the middle
 * @param x Progress through the day (0 to 1)
 * @param width Width of the plateau
 */
export function widerMiddleCurve(x: number, width: 'small' | 'medium' | 'large' = 'medium'): number {
  const widthConfig = {
    small: { start: 0.35, end: 0.65 }, // Narrow plateau (30% of day)
    medium: { start: 0.2, end: 0.8 }, // Medium plateau (60% of day)
    large: { start: 0.1, end: 0.9 }, // Wide plateau (80% of day)
  };

  const { start: plateauStart, end: plateauEnd } = widthConfig[width];

  if (x < plateauStart) {
    return Math.sin(((x / plateauStart) * Math.PI) / 2);
  } else if (x > plateauEnd) {
    return Math.cos((((x - plateauEnd) / (1 - plateauEnd)) * Math.PI) / 2);
  } else {
    return 1;
  }
}
