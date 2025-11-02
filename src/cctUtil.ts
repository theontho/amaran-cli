import { getPosition, getTimes } from 'suncalc';

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

const _CCT_DEFAULTS = {
  cctMinK: 2000,
  cctMaxK: 6500,
  intensityMinPct: 5,
  intensityMaxPct: 100,
};

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
      const [t, noon] = [
        date.getTime(),
        _solarNoon.getTime(),
      ];

      // For scientific curves, handle cases where nightEnd/night might not be available
      let nightEndTime: number;
      let nightStartTime: number;
      
      if (nightEnd instanceof Date && !isNaN(nightEnd.getTime()) && 
          night instanceof Date && !isNaN(night.getTime())) {
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
        // Direct sun altitude-based CCT calculation
        // Real daylight ranges from ~2000K at dawn to ~6500-7500K at midday
        // Allow dawn (-6°) to contribute by shifting altitude calculation
        const altitudeFactor = Math.max(0, Math.sin(altitude + Math.PI/6));
        const maxAltitudeFactor = Math.max(0, Math.sin(maxAltitude + Math.PI/6));
        f = maxAltitudeFactor > 0 ? altitudeFactor / maxAltitudeFactor : 0;
      } else if (curveType === CurveType.CIE_DAYLIGHT) {
        // CIE daylight locus with atmospheric considerations
        // Allow dawn (-6°) to contribute by shifting altitude calculation
        const altitudeFactor = Math.max(0, Math.sin(altitude + Math.PI/6));
        const maxAltitudeFactor = Math.max(0, Math.sin(maxAltitude + Math.PI/6));
        f = maxAltitudeFactor > 0 ? (altitudeFactor / maxAltitudeFactor) ** 0.8 : 0;
      } else if (curveType === CurveType.PEREZ_DAYLIGHT) {
        // Perez model with atmospheric turbidity approximation
        // Allow dawn (-6°) to contribute by shifting altitude calculation
        const altitudeFactor = Math.max(0, Math.sin(altitude + Math.PI/6));
        const maxAltitudeFactor = Math.max(0, Math.sin(maxAltitude + Math.PI/6));
        f = maxAltitudeFactor > 0 ? (altitudeFactor / maxAltitudeFactor) ** 0.6 : 0;
      }

      const cct = minK + (maxK - minK) * f;
      const intensity = minIntensity + (maxIntensity - minIntensity) * f;

      return {
        cct: Math.round(cct),
        intensity: Math.round(intensity),
      };
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
  if (isValidSunTimes(sunrise, sunset, _solarNoon) && nightEnd instanceof Date && !isNaN(nightEnd.getTime()) && 
      night instanceof Date && !isNaN(night.getTime())) {
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
  const cctMinK = clamp(opts?.cctMinK ?? _CCT_DEFAULTS.cctMinK, 1000, 20000);
  const cctMaxK = clamp(opts?.cctMaxK ?? _CCT_DEFAULTS.cctMaxK, 1000, 20000);
  const minK = Math.min(cctMinK, cctMaxK);
  const maxK = Math.max(cctMinK, cctMaxK);

  const intensityMinPct = clamp(opts?.intensityMinPct ?? _CCT_DEFAULTS.intensityMinPct, 0, 100);
  const intensityMaxPct = clamp(opts?.intensityMaxPct ?? _CCT_DEFAULTS.intensityMaxPct, 0, 100);
  const minPct = Math.min(intensityMinPct, intensityMaxPct);
  const maxPct = Math.max(intensityMinPct, intensityMaxPct);

  const minIntensity = Math.round(minPct * 10);
  const maxIntensity = Math.round(maxPct * 10);

  return calculateCCTCore(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType);
}
