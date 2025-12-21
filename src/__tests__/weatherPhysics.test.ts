import { describe, expect, it } from 'vitest';
import { calculateCCT } from '../daylightSimulation/cctUtil.js';
import { CurveType } from '../daylightSimulation/types.js';

describe('Weather-Aware Physics Curve', () => {
  // Use a fixed date and location for reproducible sun position
  // Noon at Equator on Equinox = Zenith
  const lat = 0;
  const lon = 0;
  const dateNoon = new Date('2024-03-21T12:00:00Z');
  const dateMorning = new Date('2024-03-21T08:00:00Z'); // Moderate altitude

  it('should match baseline for clear sky (no weather)', () => {
    const result = calculateCCT(
      lat,
      lon,
      dateNoon,
      {
        cctMinK: 2700,
        cctMaxK: 6500,
      },
      CurveType.PHYSICS
    );

    expect(result.cct).toBeGreaterThan(6000); // Near max at zenith
    expect(result.intensity).toBeGreaterThan(90); // Near max at zenith
  });

  it('should flatten CCT curve with 100% cloud cover', () => {
    // Clear sky morning
    const clearResult = calculateCCT(
      lat,
      lon,
      dateMorning,
      {
        cctMinK: 2000,
        cctMaxK: 6500,
        weather: { cloudCover: 0 },
      },
      CurveType.PHYSICS
    );

    // Overcast sky morning
    const cloudyResult = calculateCCT(
      lat,
      lon,
      dateMorning,
      {
        cctMinK: 2000,
        cctMaxK: 6500,
        weather: { cloudCover: 1 },
      },
      CurveType.PHYSICS
    );

    // In clear sky, morning CCT should be significantly lower than max
    // In overcast sky, CCT should be closer to neutral/max (uniform diffusion)
    // Actually, our logic: cctFactor blends towards 1.0 (maxK).
    // So cloudy CCT should be higher than clear CCT at lower altitudes (where clear is warm).

    expect(cloudyResult.cct).toBeGreaterThan(clearResult.cct);

    // Also, cloudy result should be close to maxK (factor ~ 1.0)
    expect(cloudyResult.cct).toBeCloseTo(6500, -2); // +/- 100K tolerance
  });

  it('should reduce max intensity with cloud cover (via applyWeatherModifiers)', () => {
    // Even though realistic.ts normalizes intensity shape, calculateCCT applies applyWeatherModifiers
    // which reduces the absolute intensity.

    const clearResult = calculateCCT(
      lat,
      lon,
      dateNoon,
      {
        weather: { cloudCover: 0 },
      },
      CurveType.PHYSICS
    );

    const cloudyResult = calculateCCT(
      lat,
      lon,
      dateNoon,
      {
        weather: { cloudCover: 1 },
      },
      CurveType.PHYSICS
    );

    expect(cloudyResult.intensity).toBeLessThan(clearResult.intensity);
    expect(cloudyResult.lightOutput).toBeLessThan(clearResult.lightOutput ?? Infinity);
  });

  it('should blend shapes partially with 50% cloud cover', () => {
    const halfCloudyResult = calculateCCT(
      lat,
      lon,
      dateMorning,
      {
        cctMinK: 2000,
        cctMaxK: 6500,
        weather: { cloudCover: 0.5 },
      },
      CurveType.PHYSICS
    );

    const clearResult = calculateCCT(
      lat,
      lon,
      dateMorning,
      {
        cctMinK: 2000,
        cctMaxK: 6500,
        weather: { cloudCover: 0 },
      },
      CurveType.PHYSICS
    );

    const fullCloudyResult = calculateCCT(
      lat,
      lon,
      dateMorning,
      {
        cctMinK: 2000,
        cctMaxK: 6500,
        weather: { cloudCover: 1 },
      },
      CurveType.PHYSICS
    );

    expect(halfCloudyResult.cct).toBeGreaterThan(clearResult.cct);
    expect(halfCloudyResult.cct).toBeLessThan(fullCloudyResult.cct);
  });
});
