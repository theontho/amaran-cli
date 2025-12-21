import SunCalc from 'suncalc';

const { getPosition, getTimes } = SunCalc;

import { CCT_DEFAULTS } from './constants.js';

export interface CCTResult {
  cct: number;
  intensity: number;
}

export interface CCTOptions {
  cctMinK?: number;
  cctMaxK?: number;
  intensityMinPct?: number;
  intensityMaxPct?: number;
}

export enum CurveType {
  HANN = 'hann',
  WIDER_MIDDLE_SMALL = 'wider-middle-small',
  WIDER_MIDDLE_MEDIUM = 'wider-middle-medium',
  WIDER_MIDDLE_LARGE = 'wider-middle-large',
  CIE_DAYLIGHT = 'cie-daylight',
  SUN_ALTITUDE = 'sun-altitude',
  PEREZ_DAYLIGHT = 'perez-daylight',
}

export function parseCurveType(curve: string): keyof typeof CurveType {
  const normalizedCurve = curve.toLowerCase();
  if (normalizedCurve === 'hann') {
    return 'HANN';
  } else if (normalizedCurve === 'wider-middle-small') {
    return 'WIDER_MIDDLE_SMALL';
  } else if (normalizedCurve === 'wider-middle-medium') {
    return 'WIDER_MIDDLE_MEDIUM';
  } else if (normalizedCurve === 'wider-middle-large') {
    return 'WIDER_MIDDLE_LARGE';
  } else if (normalizedCurve === 'wider-middle') {
    return 'WIDER_MIDDLE_MEDIUM'; // Default to medium for backwards compatibility
  } else if (normalizedCurve === 'cie-daylight') {
    return 'CIE_DAYLIGHT';
  } else if (normalizedCurve === 'sun-altitude') {
    return 'SUN_ALTITUDE';
  } else if (normalizedCurve === 'perez-daylight') {
    return 'PEREZ_DAYLIGHT';
  } else {
    throw new Error(
      'Invalid curve type. Use "hann", "wider-middle-small", "wider-middle-medium", "wider-middle-large", "cie-daylight", "sun-altitude", or "perez-daylight"'
    );
  }
}

export function getAvailableCurves(): string[] {
  return Object.values(CurveType);
}

type CurveFunction = (x: number) => number;

const CURVE_FUNCTIONS: Record<CurveType, CurveFunction> = {
  [CurveType.HANN]: hannCurve,
  [CurveType.WIDER_MIDDLE_SMALL]: (x: number) => widerMiddleCurve(x, 'small'),
  [CurveType.WIDER_MIDDLE_MEDIUM]: (x: number) => widerMiddleCurve(x, 'medium'),
  [CurveType.WIDER_MIDDLE_LARGE]: (x: number) => widerMiddleCurve(x, 'large'),
  [CurveType.CIE_DAYLIGHT]: cieDaylightCurve,
  [CurveType.SUN_ALTITUDE]: sunAltitudeCurve,
  [CurveType.PEREZ_DAYLIGHT]: perezDaylightCurve,
};

function hannCurve(x: number): number {
  return 0.5 * (1 - Math.cos(2 * Math.PI * x));
}

function widerMiddleCurve(x: number, width: 'small' | 'medium' | 'large' = 'medium'): number {
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

// Scientifically-based daylight curves using suncalc data

// Realistic daylight calculation functions
function calculateRealisticSunAltitude(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  // Convert altitude to degrees for easier calculations
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  // CCT: Based on real-world color temperature at different sun angles
  // Civil twilight (-6° to 0°): 4000-5000K
  // Sunrise to 30°: 5000-6500K
  // 30° to 60°: 5500-7000K
  // Above 60°: 6500-7500K
  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0; // Before civil twilight - minimum CCT
  } else if (altitudeDeg < 0) {
    // Civil twilight: 4000-5000K range
    cctFactor = 0.3 + ((altitudeDeg + 6) / 6) * 0.2; // 0.3 to 0.5
  } else if (altitudeDeg < 30) {
    // Morning/afternoon: 5000-6500K
    cctFactor = 0.5 + (altitudeDeg / 30) * 0.3; // 0.5 to 0.8
  } else if (altitudeDeg < 60) {
    // High sun: 5500-7000K
    cctFactor = 0.8 + ((altitudeDeg - 30) / 30) * 0.2; // 0.8 to 1.0
  } else {
    // Very high sun: 6500-7500K
    cctFactor = 1.0;
  }

  // Calculate raw intensity factor based on absolute altitude
  const calculateIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;
    if (altDeg < 0) return ((altDeg + 6) / 6) ** 2 * 0.05;
    if (altDeg < 10) return 0.05 + (altDeg / 10) * 0.15;
    if (altDeg < 30) return 0.2 + ((altDeg - 10) / 20) * 0.4;
    // For higher altitudes, use a standard curve that would reach 1.0 at 90 degrees
    // This serves as our "raw" value before normalization
    return 0.6 + ((altDeg - 30) / 60) * 0.4;
  };

  const rawIntensity = calculateIntensity(altitudeDeg);

  // Calculate the maximum possible intensity for this day (at solar noon)
  // This ensures that even on winter days with low max altitude, we can reach 100%
  const maxDailyIntensity = calculateIntensity(maxAltitudeDeg);

  // Normalize: Scale the current intensity so that at maxAltitude it reaches 1.0
  // Avoid division by zero if maxDailyIntensity is very small (e.g. polar night)
  let intensityFactor = maxDailyIntensity > 0.01 ? rawIntensity / maxDailyIntensity : 0;

  // Cap at 1.0 just in case
  intensityFactor = Math.min(1.0, intensityFactor);

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}

function calculateRealisticCIEDaylight(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  // CIE daylight with more realistic atmospheric modeling
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  // CCT: CIE standard illuminant D series with atmospheric scattering
  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0;
  } else if (altitudeDeg < 0) {
    // Enhanced blue during civil twilight due to Rayleigh scattering
    cctFactor = 0.4 + ((altitudeDeg + 6) / 6) ** 1.5 * 0.2; // 0.4 to 0.6
  } else if (altitudeDeg < 15) {
    // Golden hour effect: warmer light
    cctFactor = 0.6 - Math.sin((altitudeDeg * Math.PI) / 30) * 0.1; // Slight dip to 0.5
  } else if (altitudeDeg < 45) {
    // Mid-morning: rapid blue increase
    cctFactor = 0.5 + ((altitudeDeg - 15) / 30) * 0.4; // 0.5 to 0.9
  } else {
    // High sun: maximum blue
    cctFactor = 0.9 + Math.min(0.1, ((altitudeDeg - 45) / 45) * 0.1); // 0.9 to 1.0
  }

  // Calculate raw intensity based on absolute altitude (0-90 degrees)
  const calculateRawIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;
    if (altDeg < 0) return ((altDeg + 6) / 6) ** 3 * 0.03; // Very low start

    if (altDeg < 15) {
      // Atmospheric path length effect - gradual start
      // Fix: Use radians directly for sin() since altitude was originally radians,
      // but here we are working with degrees, so convert back or just use the degree value logic?
      // Actually airMass formula: 1 / sin(elevation). elevation in radians.
      // We have altDeg. Convert to radians: altDeg * PI / 180.
      const altRad = Math.max(0.01, (altDeg * Math.PI) / 180);
      const airMass = 1 / Math.sin(altRad);
      return Math.min(0.25, 1 / airMass ** 0.7);
    }

    if (altDeg < 40) {
      // Mid-morning increase
      // Map 15..40 to 0.25..0.80
      return 0.25 + ((altDeg - 15) / 25) * 0.55;
    }

    if (altDeg < 70) {
      // Approach peak
      // Map 40..70 to 0.80..0.95
      return 0.8 + ((altDeg - 40) / 30) * 0.15;
    }

    // High sun > 70
    // Map 70..90 to 0.95..1.0
    return 0.95 + ((altDeg - 70) / 20) * 0.05;
  };

  const rawIntensity = calculateRawIntensity(altitudeDeg);

  // Calculate max possible intensity for this day (normalization factor)
  const maxDailyIntensity = calculateRawIntensity(maxAltitudeDeg);

  // Normalize
  const intensityFactor = maxDailyIntensity > 0.001 ? rawIntensity / maxDailyIntensity : 0;

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}

function calculateRealisticPerezDaylight(
  altitude: number,
  maxAltitude: number
): [cctFactor: number, intensityFactor: number] {
  // Perez daylight model with turbidity and atmospheric effects
  const altitudeDeg = (altitude * 180) / Math.PI;
  const maxAltitudeDeg = (maxAltitude * 180) / Math.PI;

  // CCT: Perez model with atmospheric turbidity
  let cctFactor: number;
  if (altitudeDeg < -6) {
    cctFactor = 0;
  } else if (altitudeDeg < 0) {
    // Strong blue during twilight (high turbidity effect)
    cctFactor = 0.35 + ((altitudeDeg + 6) / 6) ** 2 * 0.25; // 0.35 to 0.6
  } else if (altitudeDeg < 25) {
    // Warm golden hour with Perez atmospheric correction
    const goldenHourEffect = Math.exp(-((altitudeDeg - 12.5) ** 2) / 100);
    cctFactor = 0.6 - goldenHourEffect * 0.15 + (altitudeDeg / 25) * 0.3; // 0.45 to 0.75
  } else if (altitudeDeg < 50) {
    // Transition to neutral white
    cctFactor = 0.75 + ((altitudeDeg - 25) / 25) * 0.2; // 0.75 to 0.95
  } else {
    // Slight cooling at very high angles
    cctFactor = Math.min(1.0, 0.95 + ((altitudeDeg - 50) / 40) * 0.05); // 0.95 to 1.0
  }

  // Calculate raw intensity based on absolute altitude (0-90 degrees)
  const calculateRawIntensity = (altDeg: number) => {
    if (altDeg < -6) return 0;

    if (altDeg < 5) {
      // Very low light near horizon
      return (Math.max(0, altDeg + 6) / 11) ** 4 * 0.15;
    }

    if (altDeg < 20) {
      // Morning increase with atmospheric effects
      const zenithAngle = Math.max(0.01, ((90 - altDeg) * Math.PI) / 180);
      const relativeLuminance = Math.exp(-0.2 / Math.max(0.01, Math.cos(zenithAngle)));
      return Math.min(0.4, relativeLuminance * 0.35 + 0.05);
    }

    if (altDeg < 45) {
      // Strong increase to midday
      // Map 20..45 to 0.25..0.9
      return 0.25 + ((altDeg - 20) / 25) * 0.65;
    }

    if (altDeg < 80) {
      // Peak approach
      // Map 45..80 to 0.9..1.0
      return 0.9 + ((altDeg - 45) / 35) * 0.1;
    }

    // High sun > 80
    return 1.0;
  };

  const rawIntensity = calculateRawIntensity(altitudeDeg);

  // Calculate max possible intensity for this day (normalization factor)
  const maxDailyIntensity = calculateRawIntensity(maxAltitudeDeg);

  // Normalize
  const intensityFactor = maxDailyIntensity > 0.001 ? rawIntensity / maxDailyIntensity : 0;

  return [Math.max(0, Math.min(1, cctFactor)), Math.max(0, Math.min(1, intensityFactor))];
}

function cieDaylightCurve(x: number): number {
  // CIE daylight locus approximation
  // Maps time of day to CCT based on CIE standard illuminant D series
  // Higher CCT (bluer) at midday, lower CCT (warmer) at sunrise/sunset
  return Math.sin(Math.PI * x) ** 0.8;
}

function sunAltitudeCurve(x: number): number {
  // Simple sun altitude-based approximation
  // CCT ≈ 2000 + 4500 × (1 - cos(altitude))
  // This creates a more gradual transition than simple sine
  return 1 - Math.cos(Math.PI * x);
}

function perezDaylightCurve(x: number): number {
  // Perez daylight model approximation
  // Accounts for atmospheric scattering and turbidity
  // More realistic transition with slightly flatter midday peak
  const zenithAngle = Math.PI * (0.5 - Math.abs(x - 0.5));
  const scattering = Math.exp(-2.0 * Math.max(0, Math.cos(zenithAngle)));
  return Math.sin(Math.PI * x) ** 0.6 * (1 - 0.2 * scattering);
}

function isValidSunTimes(sunrise: Date | undefined, sunset: Date | undefined, solarNoon: Date | undefined): boolean {
  return (
    sunrise instanceof Date &&
    !Number.isNaN(sunrise.getTime()) &&
    sunset instanceof Date &&
    !Number.isNaN(sunset.getTime()) &&
    solarNoon instanceof Date &&
    !Number.isNaN(solarNoon.getTime()) &&
    sunset.getTime() > sunrise.getTime() &&
    solarNoon.getTime() > sunrise.getTime() &&
    solarNoon.getTime() < sunset.getTime()
  );
}

function calculateCCTCore(
  lat: number,
  lon: number,
  date: Date,
  minK: number,
  maxK: number,
  minIntensity: number,
  maxIntensity: number,
  curveType: CurveType
): CCTResult {
  const curve = CURVE_FUNCTIONS[curveType];

  const times = getTimes(date, lat, lon);
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const _solarNoon = times.solarNoon;
  const nightEnd = times.nightEnd;
  const night = times.night;

  let f: number;

  // Scientific curves (CIE, SUN_ALTITUDE, PEREZ) use altitude-based calculations
  if (
    curveType === CurveType.CIE_DAYLIGHT ||
    curveType === CurveType.SUN_ALTITUDE ||
    curveType === CurveType.PEREZ_DAYLIGHT
  ) {
    f = 0; // Initialize f
    if (isValidSunTimes(sunrise, sunset, _solarNoon)) {
      const [t, _noon] = [date.getTime(), _solarNoon.getTime()];

      // For scientific curves, handle cases where nightEnd/night might not be available
      let nightEndTime: number;
      let nightStartTime: number;

      if (
        nightEnd instanceof Date &&
        !Number.isNaN(nightEnd.getTime()) &&
        night instanceof Date &&
        !Number.isNaN(night.getTime())
      ) {
        // Normal case: both nightEnd and night are available
        nightEndTime = nightEnd.getTime();
        nightStartTime = night.getTime();

        if (t <= nightEndTime || t >= nightStartTime) {
          return { cct: minK, intensity: minIntensity };
        }
      } else {
        // Edge case: no proper night (e.g., summer in high latitudes)
        // Use sunrise/sunset as boundaries for scientific curves
        nightEndTime = sunrise.getTime() - 30 * 60 * 1000; // 30 min before sunrise
        nightStartTime = sunset.getTime() + 30 * 60 * 1000; // 30 min after sunset

        if (t <= nightEndTime || t >= nightStartTime) {
          return { cct: minK, intensity: minIntensity };
        }
      }

      const pos = getPosition(date, lat, lon);
      const altitude = pos.altitude;

      // Get maximum altitude for normalization (at solar noon on this day)
      const noonPos = getPosition(_solarNoon, lat, lon);
      const maxAltitude = noonPos.altitude;

      if (curveType === CurveType.SUN_ALTITUDE) {
        // Realistic sun altitude-based calculations
        const [cctFactor, intensityFactor] = calculateRealisticSunAltitude(altitude, maxAltitude);
        const cct = minK + (maxK - minK) * cctFactor;
        const intensity = minIntensity + (maxIntensity - minIntensity) * intensityFactor;

        return {
          cct: Math.round(cct),
          intensity: Math.round(intensity),
        };
      } else if (curveType === CurveType.CIE_DAYLIGHT) {
        // Realistic CIE daylight locus calculations
        const [cctFactor, intensityFactor] = calculateRealisticCIEDaylight(altitude, maxAltitude);
        const cct = minK + (maxK - minK) * cctFactor;
        const intensity = minIntensity + (maxIntensity - minIntensity) * intensityFactor;

        return {
          cct: Math.round(cct),
          intensity: Math.round(intensity),
        };
      } else if (curveType === CurveType.PEREZ_DAYLIGHT) {
        // Realistic Perez daylight model calculations
        const [cctFactor, intensityFactor] = calculateRealisticPerezDaylight(altitude, maxAltitude);
        const cct = minK + (maxK - minK) * cctFactor;
        const intensity = minIntensity + (maxIntensity - minIntensity) * intensityFactor;

        return {
          cct: Math.round(cct),
          intensity: Math.round(intensity),
        };
      }
    } else {
      // Fallback for scientific curves when sun times are invalid
      f = 0;
      const cct = minK + (maxK - minK) * f;
      const intensity = minIntensity + (maxIntensity - minIntensity) * f;
      return {
        cct: Math.round(cct),
        intensity: Math.round(intensity),
      };
    }
  }

  // Empirical curves (HANN, WIDER_MIDDLE) use time-based calculations with nightEnd/night like scientific curves
  if (
    isValidSunTimes(sunrise, sunset, _solarNoon) &&
    nightEnd instanceof Date &&
    !Number.isNaN(nightEnd.getTime()) &&
    night instanceof Date &&
    !Number.isNaN(night.getTime())
  ) {
    const [t, noon, nightStartTime, nightEndTime] = [
      date.getTime(),
      _solarNoon.getTime(),
      night.getTime(),
      nightEnd.getTime(),
    ];

    if (t <= nightEndTime || t >= nightStartTime) {
      return { cct: minK, intensity: minIntensity };
    }

    let x: number;
    if (t <= noon) {
      // Morning: map [nightEnd, solarNoon] to [0, 0.5]
      x = ((t - nightEndTime) / (noon - nightEndTime)) * 0.5;
    } else {
      // Afternoon: map [solarNoon, night] to [0.5, 1]
      x = 0.5 + ((t - noon) / (nightStartTime - noon)) * 0.5;
    }
    f = curve(x);

    const cct = minK + (maxK - minK) * f;
    const intensity = minIntensity + (maxIntensity - minIntensity) * f;

    return {
      cct: Math.round(cct),
      intensity: Math.round(intensity),
    };
  }

  // Fallback for empirical curves when night times are not available
  try {
    const pos = getPosition(date, lat, lon);
    const altitude = pos.altitude;
    if (altitude <= 0) return { cct: minK, intensity: minIntensity };

    f = Math.max(0, Math.sin(altitude));

    const cct = minK + (maxK - minK) * f;
    const intensity = minIntensity + (maxIntensity - minIntensity) * f;

    return {
      cct: Math.round(cct),
      intensity: Math.round(intensity),
    };
  } catch (_error) {
    return { cct: minK, intensity: minIntensity };
  }
}

export function calculateCCT(
  lat: number,
  lon: number,
  date: Date = new Date(),
  opts?: CCTOptions,
  curveType: CurveType = CurveType.HANN
): CCTResult {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cctMinK = clamp(opts?.cctMinK ?? CCT_DEFAULTS.cctMinK, 1000, 20000);
  const cctMaxK = clamp(opts?.cctMaxK ?? CCT_DEFAULTS.cctMaxK, 1000, 20000);
  const minK = Math.min(cctMinK, cctMaxK);
  const maxK = Math.max(cctMinK, cctMaxK);

  const intensityMinPct = clamp(opts?.intensityMinPct ?? CCT_DEFAULTS.intensityMinPct, 0, 100);
  const intensityMaxPct = clamp(opts?.intensityMaxPct ?? CCT_DEFAULTS.intensityMaxPct, 0, 100);
  const minPct = Math.min(intensityMinPct, intensityMaxPct);
  const maxPct = Math.max(intensityMinPct, intensityMaxPct);

  const minIntensity = Math.round(minPct * 10);
  const maxIntensity = Math.round(maxPct * 10);

  return calculateCCTCore(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType);
}
