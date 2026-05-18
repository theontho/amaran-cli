export function parseStrictNumber(value: string, label: string): number {
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    throw new Error(`${label} must be a number`);
  }
  return Number(trimmed);
}

export function parseCloudCover(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    return parseStrictNumber(trimmed.slice(0, -1), 'cloud-cover') / 100;
  }
  return parseStrictNumber(trimmed, 'cloud-cover');
}
