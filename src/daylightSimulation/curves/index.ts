import { ERROR_MESSAGES } from '../constants.js';
import { CurveType } from '../types.js';
import * as approximations from './approximations.js';
import * as mathematical from './mathematical.js';

export * from './approximations.js';
export * from './mathematical.js';
export * from './realistic.js';

export type CurveFunction = (x: number) => number;

export const CURVE_FUNCTIONS: Record<CurveType, CurveFunction> = {
  [CurveType.HANN]: mathematical.hannCurve,
  [CurveType.WIDER_MIDDLE_SMALL]: (x: number) => mathematical.widerMiddleCurve(x, 'small'),
  [CurveType.WIDER_MIDDLE_MEDIUM]: (x: number) => mathematical.widerMiddleCurve(x, 'medium'),
  [CurveType.WIDER_MIDDLE_LARGE]: (x: number) => mathematical.widerMiddleCurve(x, 'large'),
  [CurveType.CIE_DAYLIGHT]: approximations.cieDaylightCurve,
  [CurveType.SUN_ALTITUDE]: approximations.sunAltitudeCurve,
  [CurveType.PEREZ_DAYLIGHT]: approximations.perezDaylightCurve,
  [CurveType.PHYSICS]: (x: number) => Math.sin(Math.PI * x) ** 1.2,
  [CurveType.BLACKBODY]: (x: number) => Math.sin(Math.PI * x) ** 1.5,
  [CurveType.HAZY]: (x: number) => Math.sin(Math.PI * x) ** 0.8,
};

/**
 * Parse a curve type string into a CurveType enum key
 */
export function parseCurveType(curve: string): keyof typeof CurveType {
  const normalizedCurve = curve.toLowerCase();
  switch (normalizedCurve) {
    case 'hann':
      return 'HANN';
    case 'wider-middle-small':
      return 'WIDER_MIDDLE_SMALL';
    case 'wider-middle-medium':
    case 'wider-middle':
      return 'WIDER_MIDDLE_MEDIUM';
    case 'wider-middle-large':
      return 'WIDER_MIDDLE_LARGE';
    case 'cie-daylight':
      return 'CIE_DAYLIGHT';
    case 'sun-altitude':
      return 'SUN_ALTITUDE';
    case 'perez-daylight':
      return 'PEREZ_DAYLIGHT';
    case 'physics':
      return 'PHYSICS';
    case 'blackbody':
      return 'BLACKBODY';
    case 'hazy':
      return 'HAZY';
    default:
      throw new Error(ERROR_MESSAGES.invalidCurve);
  }
}

/**
 * Get all available curve type names
 */
export function getAvailableCurves(): string[] {
  return Object.values(CurveType);
}
