import { CurveType, calculateCCT, parseCurveType } from './cctUtil.js';
import { CCT_DEFAULTS, VALIDATION_RANGES } from './constants.js';
import { getLocationFromIP, type Location } from './geoipUtil.js';
import { interpolateMaxLux, parseMaxLuxMap } from './mathUtil.js';
import { parseCloudCover, parseStrictNumber } from './parseUtils.js';
import type { CCTOptions, CCTResult, CircadianConfig, MaxLuxCalibration, WeatherOptions } from './types.js';
import { getWeatherData } from './weatherUtil.js';

const MAX_LUX_ERROR = 'max-lux must be a positive number OR a map string like "2700:8000,5600:10000"';

export interface CurrentCCTOptions {
  lat?: number;
  lon?: number;
  ip?: string;
  time?: Date;
  curve?: string;
  maxLux?: string;
  cloudCover?: string | number;
  precipitation?: WeatherOptions['precipitation'];
  weather?: boolean;
  debug?: boolean;
}

export interface CurrentCCTDeps {
  loadConfig?: () => CircadianConfig | null;
  fetchJson?: (url: string) => Promise<unknown>;
  getLocationFromIP?: (ip?: string) => Location | null;
  getWeatherData?: typeof getWeatherData;
}

export interface CurrentCCTResult {
  lat: number;
  lon: number;
  source: string;
  time: Date;
  curveType: keyof typeof CurveType;
  result: CCTResult;
  percent: number;
  modeDescription: string;
  weatherOptions?: WeatherOptions;
  weatherSource: 'auto' | 'manual' | 'none';
  weatherDataSource?: string;
  systemMaxLux?: MaxLuxCalibration;
  limitMaxLux?: number;
  effectiveMaxLux?: number;
  originalResult?: CCTResult;
  warnings: string[];
}

export async function calculateCurrentCCT(
  options: CurrentCCTOptions,
  deps: CurrentCCTDeps = {}
): Promise<CurrentCCTResult> {
  const config = deps.loadConfig?.() ?? {};
  const time = options.time ?? new Date();
  const warnings: string[] = [];
  const { lat, lon, source } = await resolveLocation(options, config, deps);
  const curveType = resolveCurveType(options.curve, config, warnings);
  const weather = await resolveWeather(options, config, lat, lon, time, deps);
  const { systemMaxLux, limitMaxLux } = resolveMaxLux(options.maxLux, config.maxLux);
  const bounds = resolveBounds(config);

  const cctOptions: CCTOptions = {
    cctMinK: bounds.minK,
    cctMaxK: bounds.maxK,
    intensityMinPct: bounds.minPct,
    intensityMaxPct: bounds.maxPct,
    maxLux: systemMaxLux,
    simulationMaxLux: limitMaxLux,
    weather: weather.options,
  };

  const result = calculateCCT(lat, lon, time, cctOptions, CurveType[curveType]);

  let effectiveMaxLux: number | undefined;
  let originalResult: CCTResult | undefined;
  let modeDescription = 'intensity curve';

  if (systemMaxLux !== undefined && result.lightOutput !== undefined) {
    effectiveMaxLux =
      typeof systemMaxLux === 'number'
        ? systemMaxLux
        : interpolateMaxLux(result.cct, systemMaxLux as Record<string, number>);
    modeDescription = limitMaxLux
      ? `circadian curve scaled to ${limitMaxLux} lux peak (capacity: ${Math.round(effectiveMaxLux)} lux)`
      : `max lux output of light system (${Math.round(effectiveMaxLux)} lux @ ${result.cct}K)`;

    originalResult = calculateCCT(
      lat,
      lon,
      time,
      {
        cctMinK: bounds.minK,
        cctMaxK: bounds.maxK,
        intensityMinPct: bounds.minPct,
        intensityMaxPct: bounds.maxPct,
        maxLux: systemMaxLux,
        weather: weather.options,
      },
      CurveType[curveType]
    );
  }

  const rawPercent = result.intensity / 10;
  const clampedPercent = Math.min(bounds.maxPct, Math.max(bounds.minPct, rawPercent));

  return {
    lat,
    lon,
    source,
    time,
    curveType,
    result,
    percent: Math.round(clampedPercent * 10) / 10,
    modeDescription,
    weatherOptions: weather.options,
    weatherSource: weather.source,
    weatherDataSource: weather.dataSource,
    systemMaxLux,
    limitMaxLux,
    effectiveMaxLux,
    originalResult,
    warnings,
  };
}

async function resolveLocation(
  options: CurrentCCTOptions,
  config: CircadianConfig,
  deps: CurrentCCTDeps
): Promise<{ lat: number; lon: number; source: string }> {
  if (options.lat !== undefined || options.lon !== undefined) {
    if (options.lat === undefined || options.lon === undefined) {
      throw new Error('Use both --lat and --lon to specify a manual location.');
    }
    validateLocation(options.lat, options.lon);
    return { lat: options.lat, lon: options.lon, source: 'manual' };
  }

  if (typeof config.latitude === 'number' && typeof config.longitude === 'number') {
    validateLocation(config.latitude, config.longitude);
    return { lat: config.latitude, lon: config.longitude, source: 'config' };
  }

  let ip = options.ip;
  if (!ip) {
    try {
      const data = await (deps.fetchJson ?? fetchJson)('https://api.ipify.org?format=json');
      ip = readIp(data);
    } catch (_err) {
      ip = '127.0.0.1';
    }
  }

  const location = (deps.getLocationFromIP ?? getLocationFromIP)(ip);
  if (!location?.ll) {
    throw new Error(
      'Could not determine location from IP. Use --lat and --lon to specify manually, or set defaults with: amaran config --lat <lat> --lon <lon>'
    );
  }

  const [lat, lon] = location.ll;
  validateLocation(lat, lon);
  return { lat, lon, source: `geoip (${ip})` };
}

function resolveCurveType(
  curve: string | undefined,
  config: CircadianConfig,
  warnings: string[]
): keyof typeof CurveType {
  if (curve) return parseCurveType(curve);

  if (config.defaultCurve) {
    try {
      return parseCurveType(config.defaultCurve);
    } catch (_) {
      warnings.push(`Warning: Invalid default curve in config: ${config.defaultCurve}. Using 'hann' as fallback.`);
    }
  }

  return 'HANN';
}

async function resolveWeather(
  options: CurrentCCTOptions,
  config: CircadianConfig,
  lat: number,
  lon: number,
  time: Date,
  deps: CurrentCCTDeps
): Promise<{ options?: WeatherOptions; source: 'auto' | 'manual' | 'none'; dataSource?: string }> {
  const useAutoWeather = options.weather || (options.weather === undefined && config.weather === true);
  if (useAutoWeather) {
    const weather = await (deps.getWeatherData ?? getWeatherData)(lat, lon, time, options.debug);
    return {
      options: {
        cloudCover: weather.cloudCover,
        precipitation: weather.precipitation,
      },
      source: 'auto',
      dataSource: weather.source,
    };
  }

  const cloudCover = parseCloudCover(options.cloudCover);
  if (cloudCover !== undefined || options.precipitation !== undefined) {
    return {
      options: {
        cloudCover,
        precipitation: options.precipitation,
      },
      source: 'manual',
    };
  }

  return { source: 'none' };
}

function resolveMaxLux(
  maxLuxInput: string | undefined,
  configMaxLux: CircadianConfig['maxLux']
): { systemMaxLux?: MaxLuxCalibration; limitMaxLux?: number } {
  let systemMaxLux = configMaxLux;

  if (!maxLuxInput) {
    return { systemMaxLux };
  }

  if (maxLuxInput.includes(':')) {
    const map = parseMaxLuxMap(maxLuxInput);
    if (!map) throw new Error(MAX_LUX_ERROR);
    systemMaxLux = map;
    return { systemMaxLux };
  }

  let parsed: number;
  try {
    parsed = parseStrictNumber(maxLuxInput, 'max-lux');
  } catch (_error) {
    throw new Error(MAX_LUX_ERROR);
  }
  if (parsed <= 0) throw new Error(MAX_LUX_ERROR);

  if (systemMaxLux === undefined) {
    systemMaxLux = parsed;
  }

  return { systemMaxLux, limitMaxLux: parsed };
}

function resolveBounds(config: CircadianConfig) {
  const minKCfg = typeof config.cctMin === 'number' ? config.cctMin : undefined;
  const maxKCfg = typeof config.cctMax === 'number' ? config.cctMax : undefined;
  const minK =
    minKCfg !== undefined ? clamp(minKCfg, VALIDATION_RANGES.cct.min, VALIDATION_RANGES.cct.max) : CCT_DEFAULTS.cctMinK;
  const maxK =
    maxKCfg !== undefined ? clamp(maxKCfg, VALIDATION_RANGES.cct.min, VALIDATION_RANGES.cct.max) : CCT_DEFAULTS.cctMaxK;

  const minPctCfg = typeof config.intensityMin === 'number' ? config.intensityMin : CCT_DEFAULTS.intensityMinPct;
  const maxPctCfg = typeof config.intensityMax === 'number' ? config.intensityMax : CCT_DEFAULTS.intensityMaxPct;
  const minPct = clamp(
    Math.min(minPctCfg, maxPctCfg),
    VALIDATION_RANGES.intensity.min,
    VALIDATION_RANGES.intensity.max
  );
  const maxPct = clamp(
    Math.max(minPctCfg, maxPctCfg),
    VALIDATION_RANGES.intensity.min,
    VALIDATION_RANGES.intensity.max
  );

  return {
    minK: Math.min(minK, maxK),
    maxK: Math.max(minK, maxK),
    minPct,
    maxPct,
  };
}

function validateLocation(lat: number, lon: number): void {
  if (Number.isNaN(lat) || lat < VALIDATION_RANGES.latitude.min || lat > VALIDATION_RANGES.latitude.max) {
    throw new Error(`Latitude must be between ${VALIDATION_RANGES.latitude.min} and ${VALIDATION_RANGES.latitude.max}`);
  }
  if (Number.isNaN(lon) || lon < VALIDATION_RANGES.longitude.min || lon > VALIDATION_RANGES.longitude.max) {
    throw new Error(
      `Longitude must be between ${VALIDATION_RANGES.longitude.min} and ${VALIDATION_RANGES.longitude.max}`
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} while fetching ${url}`);
  }
  if (!body) {
    throw new Error(`Empty JSON response while fetching ${url}`);
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Invalid JSON response while fetching ${url}: ${(error as Error).message}`);
  }
}

function readIp(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const ip = (data as { ip?: unknown }).ip;
  return typeof ip === 'string' ? ip : undefined;
}
