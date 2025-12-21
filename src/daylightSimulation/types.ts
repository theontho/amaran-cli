// Daylight simulation specific types
export * from '../deviceControl/types.js';

export interface CCTResult {
  cct: number;
  intensity: number;
  lightOutput?: number; // Estimated lux or luminosity
}

export interface WeatherOptions {
  cloudCover?: number; // 0-1, 0 = clear, 1 = overcast
  precipitation?: 'none' | 'rain' | 'snow' | 'drizzle';
}

export interface CCTOptions {
  cctMinK?: number;
  cctMaxK?: number;
  intensityMinPct?: number;
  intensityMaxPct?: number;
  weather?: WeatherOptions;
}

export enum CurveType {
  HANN = 'hann',
  WIDER_MIDDLE_SMALL = 'wider-middle-small',
  WIDER_MIDDLE_MEDIUM = 'wider-middle-medium',
  WIDER_MIDDLE_LARGE = 'wider-middle-large',
  CIE_DAYLIGHT = 'cie-daylight',
  SUN_ALTITUDE = 'sun-altitude',
  PEREZ_DAYLIGHT = 'perez-daylight',
  PHYSICS = 'physics',
  BLACKBODY = 'blackbody',
  HAZY = 'hazy',
}
