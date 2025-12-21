import SunCalc from 'suncalc';

const { getPosition, getTimes } = SunCalc;

import { CCT_DEFAULTS } from './constants.js';
import {
  CURVE_FUNCTIONS,
  calculateRealisticBlackbodyDaylight,
  calculateRealisticCIEDaylight,
  calculateRealisticHazyDaylight,
  calculateRealisticPerezDaylight,
  calculateRealisticPhysicsDaylight,
  calculateRealisticSunAltitude,
  getAvailableCurves,
  parseCurveType,
} from './curves/index.js';
import { type CCTOptions, type CCTResult, CurveType } from './types.js';

// Re-export for backward compatibility
export { type CCTOptions, type CCTResult, CurveType, getAvailableCurves, parseCurveType };

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

/**
 * Handle scientific curves (CIE, SUN_ALTITUDE, PEREZ) which use altitude-based calculations
 */
function calculateScientificCCT(
  lat: number,
  lon: number,
  date: Date,
  minK: number,
  maxK: number,
  minIntensity: number,
  maxIntensity: number,
  curveType: CurveType,
  times: SunCalc.GetTimesResult
): CCTResult {
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const _solarNoon = times.solarNoon;
  const nightEnd = times.nightEnd;
  const night = times.night;

  if (!isValidSunTimes(sunrise, sunset, _solarNoon)) {
    return {
      cct: Math.round(minK),
      intensity: Math.round(minIntensity),
    };
  }

  const t = date.getTime();

  // For scientific curves, handle cases where nightEnd/night might not be available
  let nightEndTime: number;
  let nightStartTime: number;

  if (
    nightEnd instanceof Date &&
    !Number.isNaN(nightEnd.getTime()) &&
    night instanceof Date &&
    !Number.isNaN(night.getTime())
  ) {
    nightEndTime = nightEnd.getTime();
    nightStartTime = night.getTime();
  } else {
    // Edge case: no proper night (e.g., summer in high latitudes)
    nightEndTime = sunrise.getTime() - 30 * 60 * 1000;
    nightStartTime = sunset.getTime() + 30 * 60 * 1000;
  }

  if (t <= nightEndTime || t >= nightStartTime) {
    return { cct: minK, intensity: minIntensity };
  }

  const pos = getPosition(date, lat, lon);
  const altitude = pos.altitude;
  const noonPos = getPosition(_solarNoon, lat, lon);
  const maxAltitude = noonPos.altitude;

  let factors: [number, number];
  switch (curveType) {
    case CurveType.SUN_ALTITUDE:
      factors = calculateRealisticSunAltitude(altitude, maxAltitude);
      break;
    case CurveType.CIE_DAYLIGHT:
      factors = calculateRealisticCIEDaylight(altitude, maxAltitude);
      break;
    case CurveType.PEREZ_DAYLIGHT:
      factors = calculateRealisticPerezDaylight(altitude, maxAltitude);
      break;
    case CurveType.PHYSICS:
      factors = calculateRealisticPhysicsDaylight(altitude, maxAltitude);
      break;
    case CurveType.BLACKBODY:
      factors = calculateRealisticBlackbodyDaylight(altitude, maxAltitude);
      break;
    case CurveType.HAZY:
      factors = calculateRealisticHazyDaylight(altitude, maxAltitude);
      break;
    default:
      factors = [0, 0];
  }

  const [cctFactor, intensityFactor] = factors;
  return {
    cct: Math.round(minK + (maxK - minK) * cctFactor),
    intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * intensityFactor),
  };
}

/**
 * Handle empirical curves (HANN, WIDER_MIDDLE) which use time-based calculations
 */
function calculateEmpiricalCCT(
  lat: number,
  lon: number,
  date: Date,
  minK: number,
  maxK: number,
  minIntensity: number,
  maxIntensity: number,
  curveType: CurveType,
  times: SunCalc.GetTimesResult
): CCTResult {
  const curve = CURVE_FUNCTIONS[curveType];
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const _solarNoon = times.solarNoon;
  const nightEnd = times.nightEnd;
  const night = times.night;

  if (
    isValidSunTimes(sunrise, sunset, _solarNoon) &&
    nightEnd instanceof Date &&
    !Number.isNaN(nightEnd.getTime()) &&
    night instanceof Date &&
    !Number.isNaN(night.getTime())
  ) {
    const t = date.getTime();
    const noon = _solarNoon.getTime();
    const nightStartTime = night.getTime();
    const nightEndTime = nightEnd.getTime();

    if (t <= nightEndTime || t >= nightStartTime) {
      return { cct: minK, intensity: minIntensity };
    }

    let x: number;
    if (t <= noon) {
      x = ((t - nightEndTime) / (noon - nightEndTime)) * 0.5;
    } else {
      x = 0.5 + ((t - noon) / (nightStartTime - noon)) * 0.5;
    }

    const f = curve(x);
    return {
      cct: Math.round(minK + (maxK - minK) * f),
      intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * f),
    };
  }

  // Fallback for empirical curves when night times are not available
  try {
    const pos = getPosition(date, lat, lon);
    if (pos.altitude <= 0) return { cct: minK, intensity: minIntensity };

    const f = Math.max(0, Math.sin(pos.altitude));
    return {
      cct: Math.round(minK + (maxK - minK) * f),
      intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * f),
    };
  } catch {
    return { cct: minK, intensity: minIntensity };
  }
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
  const times = getTimes(date, lat, lon);

  const isScientific =
    curveType === CurveType.CIE_DAYLIGHT ||
    curveType === CurveType.SUN_ALTITUDE ||
    curveType === CurveType.PEREZ_DAYLIGHT ||
    curveType === CurveType.PHYSICS ||
    curveType === CurveType.BLACKBODY ||
    curveType === CurveType.HAZY;

  if (isScientific) {
    return calculateScientificCCT(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType, times);
  }

  return calculateEmpiricalCCT(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType, times);
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
