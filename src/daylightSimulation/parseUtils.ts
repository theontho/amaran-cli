export function parseStrictNumber(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    throw new Error(`${label} must be a number`);
  }
  return Number(trimmed);
}

export function parseCloudCover(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return validateCloudCover(value);

  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return validateCloudCover(parseStrictNumber(trimmed.slice(0, -1), 'cloud-cover') / 100);
  }
  return validateCloudCover(parseStrictNumber(trimmed, 'cloud-cover'));
}

function validateCloudCover(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('cloud-cover must be between 0 and 1, or between 0% and 100%');
  }
  return value;
}
