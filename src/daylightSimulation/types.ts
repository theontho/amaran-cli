// Daylight simulation specific types
export * from '../deviceControl/types.js';

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
