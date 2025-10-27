import { getPosition, getTimes } from 'suncalc';

export interface CCTResult {
  cct: number;
  intensity: number;
}

export interface CCTOptions {
  /** Minimum CCT in Kelvin (default 2000K) */
  cctMinK?: number;
  /** Maximum CCT in Kelvin (default 6500K) */
  cctMaxK?: number;
  /** Minimum intensity in percent [0-100] (default 10%) */
  intensityMinPct?: number;
  /** Maximum intensity in percent [0-100] (default 100%) */
  intensityMaxPct?: number;
}

const _CCT_DEFAULTS = {
  cctMinK: 2000,
  cctMaxK: 6500,
  intensityMinPct: 5,
  intensityMaxPct: 100,
};

/**
 * Calculate CCT (correlated color temperature) and intensity based on sunrise/sunset for a location and time.
 * Requirements:
 * - Outside sunrise/sunset window: return 2000K at 10% intensity (warmest min, dimmest)
 * - Within sunrise→sunset: follow a smooth bell-shaped curve that is 2000K/10% at both ends
 *   and peaks at 6500K/100% at solar noon (the middle)
 *
 * Note: Intensity is returned in 0-1000 range (Amaran API format), where 100 = 10%, 1000 = 100%.
 * You can override the min/max CCT and intensity (percent) via the options parameter.
 */
export function calculateCCT(
  lat: number,
  lon: number,
  date: Date = new Date(),
  opts?: CCTOptions
): CCTResult {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cctMinK = clamp(opts?.cctMinK ?? _CCT_DEFAULTS.cctMinK, 1000, 20000);
  const cctMaxK = clamp(opts?.cctMaxK ?? _CCT_DEFAULTS.cctMaxK, 1000, 20000);
  const loK = Math.min(cctMinK, cctMaxK);
  const hiK = Math.max(cctMinK, cctMaxK);

  const intensityMinPct = clamp(opts?.intensityMinPct ?? _CCT_DEFAULTS.intensityMinPct, 0, 100);
  const intensityMaxPct = clamp(opts?.intensityMaxPct ?? _CCT_DEFAULTS.intensityMaxPct, 0, 100);
  const loPct = Math.min(intensityMinPct, intensityMaxPct);
  const hiPct = Math.max(intensityMinPct, intensityMaxPct);

  const MIN_K = loK;
  const MAX_K = hiK;
  const MIN_INTENSITY = Math.round(loPct * 10); // API expects 0-1000 range
  const MAX_INTENSITY = Math.round(hiPct * 10); // API expects 0-1000 range

  // Compute sun times for the given date and location
  let sunrise: Date | undefined;
  let sunset: Date | undefined;
  let _solarNoon: Date | undefined;

  try {
    const times = getTimes(date, lat, lon);
    sunrise = times.sunrise;
    sunset = times.sunset;
    _solarNoon = times.solarNoon;
  } catch (_) {
    // If suncalc fails, fall back to altitude-based heuristic below
  }

  // Helper: Hann window curve over [0,1]: 0.5 * (1 - cos(2πx))
  const hann = (x: number) => 0.5 * (1 - Math.cos(2 * Math.PI * x));

  // If we have valid sunrise/sunset for the day and a positive day length, use the windowed curve
  if (
    sunrise instanceof Date &&
    !Number.isNaN(sunrise.getTime()) &&
    sunset instanceof Date &&
    !Number.isNaN(sunset.getTime()) &&
    sunset.getTime() > sunrise.getTime()
  ) {
    const t = date.getTime();
    const start = sunrise.getTime();
    const end = sunset.getTime();

    if (t <= start || t >= end) {
      return { cct: MIN_K, intensity: MIN_INTENSITY };
    }

    // Normalize current time within [sunrise, sunset] to x in [0,1]
    const x = (t - start) / (end - start);

    // Bell-shaped curve, 0 at edges, 1 at middle (solar noon is ~ middle)
    const f = hann(x);

    const cct = MIN_K + (MAX_K - MIN_K) * f;
    const intensity = MIN_INTENSITY + (MAX_INTENSITY - MIN_INTENSITY) * f;

    return {
      cct: Math.round(cct),
      intensity: Math.round(intensity),
    };
  }

  // Fallback: use solar altitude as a proxy (robust near polar regions or if times missing)
  try {
    const pos = getPosition(date, lat, lon);
    const altitude = pos.altitude; // radians above horizon, <= 0 means below horizon
    if (altitude <= 0) return { cct: MIN_K, intensity: MIN_INTENSITY };

    // Map altitude [0 .. π/2] to [0 .. 1] using sine for a bell-ish shape
    const f = Math.max(0, Math.sin(altitude));
    const cct = MIN_K + (MAX_K - MIN_K) * Math.min(1, f);
    const intensity = MIN_INTENSITY + (MAX_INTENSITY - MIN_INTENSITY) * Math.min(1, f);

    return {
      cct: Math.round(cct),
      intensity: Math.round(intensity),
    };
  } catch (_) {
    // As a last resort, hold the minimum
    return { cct: MIN_K, intensity: MIN_INTENSITY };
  }
}
