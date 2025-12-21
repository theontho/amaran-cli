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
import { type CCTOptions, type CCTResult, CurveType, WeatherOptions } from './types.js';

// Re-export for backward compatibility
export { type CCTOptions, type CCTResult, CurveType, WeatherOptions, getAvailableCurves, parseCurveType };

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
  times: SunCalc.GetTimesResult,
  weather?: WeatherOptions
): CCTResult {
  const sunrise = times.sunrise;
  const sunset = times.sunset;
  const _solarNoon = times.solarNoon;
  const nightEnd = times.nightEnd;
  const night = times.night;

  // For scientific curves, we need solarNoon to establish a daily peak for normalization.
  // Sunrise/sunset may be missing at the poles (Polar Day/Night).
  if (!(_solarNoon instanceof Date) || Number.isNaN(_solarNoon.getTime())) {
    return {
      cct: Math.round(minK),
      intensity: Math.round(minIntensity),
      lightOutput: 0,
    };
  }

  const t = date.getTime();

  // If we have valid sunrise/sunset, enforce night minimums outside of daylight hours.
  if (
    sunrise instanceof Date &&
    !Number.isNaN(sunrise.getTime()) &&
    sunset instanceof Date &&
    !Number.isNaN(sunset.getTime())
  ) {
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
      // Edge case: no proper night configuration but has sunrise/sunset
      nightEndTime = sunrise.getTime() - 30 * 60 * 1000;
      nightStartTime = sunset.getTime() + 30 * 60 * 1000;
    }

    if (t <= nightEndTime || t >= nightStartTime) {
      return { cct: minK, intensity: minIntensity, lightOutput: 0 };
    }
  }

  const pos = getPosition(date, lat, lon);
  const altitude = pos.altitude;
  const noonPos = getPosition(_solarNoon, lat, lon);
  const maxAltitude = noonPos.altitude;

  let factors: [number, number, number];
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
      factors = calculateRealisticPhysicsDaylight(altitude, maxAltitude, weather);
      break;
    case CurveType.BLACKBODY:
      factors = calculateRealisticBlackbodyDaylight(altitude, maxAltitude);
      break;
    case CurveType.HAZY:
      factors = calculateRealisticHazyDaylight(altitude, maxAltitude);
      break;
    default:
      factors = [0, 0, 0];
  }

  const [cctFactor, intensityFactor, rawIntensity] = factors;
  return {
    cct: Math.round(minK + (maxK - minK) * cctFactor),
    intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * intensityFactor),
    lightOutput: Math.round(rawIntensity * CCT_DEFAULTS.maxLux),
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
      return { cct: minK, intensity: minIntensity, lightOutput: 0 };
    }

    let x: number;
    if (t <= noon) {
      x = ((t - nightEndTime) / (noon - nightEndTime)) * 0.5;
    } else {
      x = 0.5 + ((t - noon) / (nightStartTime - noon)) * 0.5;
    }

    const f = curve(x);
    // For empirical curves, we don't have a physical model, but we can estimate
    // light output based on the curve factor and the max potential lux.
    // We scale it by sin(altitude) if available to give some seasonal variation.
    let luxEstimate = f * CCT_DEFAULTS.maxLux;
    try {
      const pos = getPosition(date, lat, lon);
      if (pos.altitude > 0) {
        luxEstimate *= Math.sin(pos.altitude);
      } else {
        luxEstimate = 0;
      }
    } catch {
      // Fallback if SunCalc fails
    }

    return {
      cct: Math.round(minK + (maxK - minK) * f),
      intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * f),
      lightOutput: Math.round(luxEstimate),
    };
  }

  // Fallback for empirical curves when night times are not available
  try {
    const pos = getPosition(date, lat, lon);
    if (pos.altitude <= 0) return { cct: minK, intensity: minIntensity, lightOutput: 0 };

    const f = Math.max(0, Math.sin(pos.altitude));
    return {
      cct: Math.round(minK + (maxK - minK) * f),
      intensity: Math.round(minIntensity + (maxIntensity - minIntensity) * f),
      lightOutput: Math.round(f * CCT_DEFAULTS.maxLux),
    };
  } catch {
    return { cct: minK, intensity: minIntensity, lightOutput: 0 };
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
  curveType: CurveType,
  weather?: WeatherOptions
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
    return calculateScientificCCT(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType, times, weather);
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

  // Apply weather modifiers if provided
  let result = calculateCCTCore(lat, lon, date, minK, maxK, minIntensity, maxIntensity, curveType, opts?.weather);

  if (opts?.weather) {
    result = applyWeatherModifiers(result, opts.weather);
  }

  return result;
}

function applyWeatherModifiers(result: CCTResult, weather: WeatherOptions): CCTResult {
  const { cloudCover = 0, precipitation = 'none' } = weather;
  let { cct, intensity, lightOutput = 0 } = result;

  // Cloud cover logic:
  // 1. Reduce intensity linearly: 0% clouds = 100%, 100% clouds = 20% intensity
  const cloudIntensityFactor = 1 - Math.min(1, Math.max(0, cloudCover)) * 0.8;
  intensity = Math.round(intensity * cloudIntensityFactor);
  lightOutput = Math.round(lightOutput * cloudIntensityFactor);

  // 2. Shift CCT towards 6500K (neutral/overcast) based on cloud cover
  // Heavy clouds act as a diffuser, mixing direct sun and blue sky to a uniform ~6500K
  const targetK = 6500;
  const cloudMix = Math.min(1, Math.max(0, cloudCover));
  cct = Math.round(cct * (1 - cloudMix) + targetK * cloudMix);

  // Precipitation logic:
  // Additional intensity reduction beyond cloud cover
  let precipFactor = 1.0;
  switch (precipitation) {
    case 'rain':
      precipFactor = 0.8;
      // Rain also tends to cool the light slightly (scattering)
      cct = Math.round(cct * 0.9 + 7000 * 0.1);
      break;
    case 'snow':
      precipFactor = 0.9; // Snow reflects light, maybe less dark than rain? But falling snow blocks.
      // Snow reflection can make things very cool/blue
      cct = Math.round(cct * 0.8 + 8000 * 0.2);
      break;
    case 'drizzle':
      precipFactor = 0.9;
      break;
    default:
      precipFactor = 1.0;
  }

  intensity = Math.round(intensity * precipFactor);
  lightOutput = Math.round(lightOutput * precipFactor);

  return { cct, intensity, lightOutput };
}
