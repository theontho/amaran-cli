import chalk from 'chalk';

// CCT calculation defaults
export const CCT_DEFAULTS = {
  cctMinK: 1700, // 1700K is the CCT of campfires or candles
  cctMaxK: 5500, // 5500K is the CCT of non-overcast noon sunlight
  intensityMinPct: 5,
  intensityMaxPct: 100,
};

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
  invalidCurve:
    'Invalid curve type. Use "hann", "wider-middle-small", "wider-middle-medium", "wider-middle-large", "cie-daylight", "sun-altitude", or "perez-daylight"',
  locationUnavailable: 'Could not determine location. Use --lat and --lon to specify manually.',
  nightTimesUnavailable: 'Could not calculate night times for this location',
} as const;
