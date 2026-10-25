import { describe, expect, it } from 'vitest';
import { formatSource } from '../daylightSimulation/privacyUtil.js';

describe('formatSource', () => {
  it('redacts the first three octets of an IPv4 address', () => {
    expect(formatSource('geoip (203.0.113.42)')).toBe('geoip (XXX.XXX.XXX.42)');
  });

  it('leaves sources unchanged when privacy is off or no address is present', () => {
    expect(formatSource('geoip (203.0.113.42)', true)).toBe('geoip (203.0.113.42)');
    expect(formatSource('config (manual)')).toBe('config (manual)');
  });

  it('handles long digit runs without catastrophic backtracking', () => {
    const input = `geoip (${'1.'.repeat(50_000)})`;
    const started = performance.now();
    formatSource(input);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
