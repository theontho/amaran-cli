import chalk from 'chalk';
import { CurveType } from './types.js';

// CCT calculation defaults
export const CCT_DEFAULTS = {
  cctMinK: 1700, // 1700K is the CCT of campfires or candles
  cctMaxK: 5500, // 5500K is the CCT of non-overcast noon sunlight
  intensityMinPct: 5,
  intensityMaxPct: 100,
  maxLux: 110000, // Approximate clear sky zenith lux
};

// Curve metadata for consistent naming and ordering
export const CURVE_METADATA: Record<keyof typeof CurveType, { shortName: string; fullName: string }> = {
  HANN: { shortName: 'HANN', fullName: 'Hann Window' },
  WIDER_MIDDLE_SMALL: { shortName: 'WM_SML', fullName: 'Wider Middle (Small)' },
  WIDER_MIDDLE_MEDIUM: { shortName: 'WM_MED', fullName: 'Wider Middle (Medium)' },
  WIDER_MIDDLE_LARGE: { shortName: 'WM_LRG', fullName: 'Wider Middle (Large)' },
  CIE_DAYLIGHT: { shortName: 'CIE', fullName: 'CIE Daylight' },
  SUN_ALTITUDE: { shortName: 'SUN_ALT', fullName: 'Sun Altitude' },
  PEREZ_DAYLIGHT: { shortName: 'PEREZ', fullName: 'Perez Daylight' },
  PHYSICS: { shortName: 'PHYS', fullName: 'Physics' },
  BLACKBODY: { shortName: 'BLACK', fullName: 'Blackbody' },
  HAZY: { shortName: 'HAZY', fullName: 'Hazy' },
};

// Canonical ordering of curves
export const ALL_CURVE_TYPES_ORDERED = Object.keys(CURVE_METADATA) as (keyof typeof CurveType)[];

// Generate list of valid curve values (strings like "hann", "cie-daylight") for help text
export const VALID_CURVES_LIST = Object.values(CurveType).join(', ');

// Special time configuration - single source of truth for colors and emojis
export const SPECIAL_TIME_CONFIG = [
  { key: 'nightEnd', color: chalk.blue, emoji: 'NE' },
  { key: 'nauticalDawn', color: chalk.cyan, emoji: 'DN' },
  { key: 'dawn', color: chalk.cyan, emoji: 'DA' },
  { key: 'sunrise', color: chalk.yellow, emoji: 'SR' },
  { key: 'sunriseEnd', color: chalk.yellow, emoji: 'SE' },
  { key: 'goldenHourEnd', color: chalk.yellow, emoji: 'GE' },
  { key: 'solarNoon', color: chalk.green, emoji: 'SN' },
  { key: 'goldenHour', color: chalk.yellow, emoji: 'GH' },
  { key: 'sunsetStart', color: chalk.magenta, emoji: 'SB' },
  { key: 'sunset', color: chalk.magenta, emoji: 'SS' },
  { key: 'nauticalDusk', color: chalk.magenta, emoji: 'ND' },
  { key: 'dusk', color: chalk.magenta, emoji: 'DU' },
  { key: 'night', color: chalk.blue, emoji: 'NI' },
] as const;

// Validation ranges
export const VALIDATION_RANGES = {
  latitude: { min: -90, max: 90 },
  longitude: { min: -180, max: 180 },
};

// Error messages
export const ERROR_MESSAGES = {
  invalidLatitude: `Latitude must be between ${VALIDATION_RANGES.latitude.min} and ${VALIDATION_RANGES.latitude.max}`,
  invalidLongitude: `Longitude must be between ${VALIDATION_RANGES.longitude.min} and ${VALIDATION_RANGES.longitude.max}`,
  invalidCurve: `Invalid curve type. Use one of: ${VALID_CURVES_LIST}`,
  locationUnavailable: 'Could not determine location. Use --lat and --lon to specify manually.',
  nightTimesUnavailable: 'Could not calculate night times for this location',
} as const;

export const CURVE_HELP_TEXT = `Curve type (${VALID_CURVES_LIST})`;
