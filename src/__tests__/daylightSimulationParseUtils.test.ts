import { describe, expect, it } from 'vitest';
import { parseCloudCover } from '../daylightSimulation/parseUtils.js';

describe('daylight simulation parse utils', () => {
  it('parses cloud cover fractions and percentages', () => {
    expect(parseCloudCover('0.5')).toBe(0.5);
    expect(parseCloudCover('50%')).toBe(0.5);
    expect(parseCloudCover(1)).toBe(1);
  });

  it('rejects cloud cover values outside the supported range', () => {
    expect(() => parseCloudCover('1.5')).toThrow(RangeError);
    expect(() => parseCloudCover('150%')).toThrow(RangeError);
    expect(() => parseCloudCover(-0.1)).toThrow(RangeError);
    expect(() => parseCloudCover(Number.NaN)).toThrow(RangeError);
  });
});
