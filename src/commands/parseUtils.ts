export { parseCloudCover } from '../daylightSimulation/parseUtils.js';

export function parseStrictNumber(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    throw new Error(`${label} must be a number`);
  }
  return Number(trimmed);
}

export function parseStrictInteger(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${label} must be an integer`);
  }
  return Number(trimmed);
}

export function parseBooleanString(value: string, label: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  throw new Error(`${label} must be true or false`);
}

export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
