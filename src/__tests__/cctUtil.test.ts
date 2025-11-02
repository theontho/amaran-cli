import { getTimes } from 'suncalc';
import { calculateCCT } from '../cctUtil';

describe('calculateCCT', () => {
  const NYC_LAT = 40.7128;
  const NYC_LON = -74.006;

  describe('NYC circadian lighting tests', () => {
    let testDate: Date;
    let sunrise: Date;
    let sunset: Date;
    let solarNoon: Date;
    const MIN_INTENSITY_PCT = 5;
    const MAX_INTENSITY_PCT = 100;
    const MIN_CCT = 2000;
    const MAX_CCT = 6500;
    const MIN_INTENSITY_API = MIN_INTENSITY_PCT * 10; // API format (50)
    const MAX_INTENSITY_API = MAX_INTENSITY_PCT * 10; // API format (1000)

    beforeAll(() => {
      // Use a fixed date for consistent test results
      testDate = new Date('2024-06-21T12:00:00Z'); // Summer solstice
      const times = getTimes(testDate, NYC_LAT, NYC_LON);
      sunrise = times.sunrise;
      sunset = times.sunset;
      solarNoon = times.solarNoon;
    });

    it('should return minimum CCT and intensity before sunrise', () => {
      const beforeSunrise = new Date(sunrise.getTime() - 60_000); // 1 minute before
      const result = calculateCCT(NYC_LAT, NYC_LON, beforeSunrise, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      expect(result.cct).toBe(MIN_CCT);
      expect(result.intensity).toBe(MIN_INTENSITY_API);
    });

    it('should return minimum CCT and intensity at sunrise edge', () => {
      const atSunrise = new Date(sunrise.getTime());
      const result = calculateCCT(NYC_LAT, NYC_LON, atSunrise, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      // At the exact sunrise moment, should be at minimum
      expect(result.cct).toBe(MIN_CCT);
      expect(result.intensity).toBe(MIN_INTENSITY_API);
    });

    it('should return maximum CCT and intensity at solar noon', () => {
      const atNoon = new Date(solarNoon.getTime());
      const result = calculateCCT(NYC_LAT, NYC_LON, atNoon, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      // At solar noon (middle of the day), should be at maximum
      expect(result.cct).toBe(MAX_CCT);
      expect(result.intensity).toBe(MAX_INTENSITY_API);
    });

    it('should return minimum CCT and intensity at sunset edge', () => {
      const atSunset = new Date(sunset.getTime());
      const result = calculateCCT(NYC_LAT, NYC_LON, atSunset, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      // At the exact sunset moment, should be at minimum
      expect(result.cct).toBe(MIN_CCT);
      expect(result.intensity).toBe(MIN_INTENSITY_API);
    });

    it('should return minimum CCT and intensity after sunset', () => {
      const afterSunset = new Date(sunset.getTime() + 60_000); // 1 minute after
      const result = calculateCCT(NYC_LAT, NYC_LON, afterSunset, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      expect(result.cct).toBe(MIN_CCT);
      expect(result.intensity).toBe(MIN_INTENSITY_API);
    });

    it('should have smooth progression from sunrise to noon', () => {
      const quarterWay = new Date(sunrise.getTime() + (solarNoon.getTime() - sunrise.getTime()) / 4);
      const result = calculateCCT(NYC_LAT, NYC_LON, quarterWay, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      // Should be between minimum and maximum values
      expect(result.cct).toBeGreaterThan(MIN_CCT);
      expect(result.cct).toBeLessThan(MAX_CCT);
      expect(result.intensity).toBeGreaterThan(MIN_INTENSITY_API);
      expect(result.intensity).toBeLessThan(MAX_INTENSITY_API);
    });

    it('should have smooth progression from noon to sunset', () => {
      const threeQuartersWay = new Date(solarNoon.getTime() + (sunset.getTime() - solarNoon.getTime()) / 2);
      const result = calculateCCT(NYC_LAT, NYC_LON, threeQuartersWay, {
        intensityMinPct: MIN_INTENSITY_PCT,
        intensityMaxPct: MAX_INTENSITY_PCT,
        cctMinK: MIN_CCT,
        cctMaxK: MAX_CCT,
      });

      // Should be between minimum and maximum values
      expect(result.cct).toBeGreaterThan(MIN_CCT);
      expect(result.cct).toBeLessThan(MAX_CCT);
      expect(result.intensity).toBeGreaterThan(MIN_INTENSITY_API);
      expect(result.intensity).toBeLessThan(MAX_INTENSITY_API);
    });
  });

  describe('Edge cases', () => {
    it('should handle midnight times', () => {
      const midnight = new Date('2024-06-21T04:00:00Z'); // Midnight in NYC
      const result = calculateCCT(NYC_LAT, NYC_LON, midnight);

      expect(result.cct).toBe(2000);
      expect(result.intensity).toBe(50); // 5% with default
    });

    it('should return valid results for different locations', () => {
      const LONDON_LAT = 51.5074;
      const LONDON_LON = -0.1278;
      const testDate = new Date('2024-06-21T12:00:00Z');

      const result = calculateCCT(LONDON_LAT, LONDON_LON, testDate);

      expect(result.cct).toBeGreaterThanOrEqual(2000);
      expect(result.cct).toBeLessThanOrEqual(6500);
      expect(result.intensity).toBeGreaterThanOrEqual(50); // 5% minimum
      expect(result.intensity).toBeLessThanOrEqual(1000);
    });

    it('should use default date if not provided', () => {
      const result = calculateCCT(NYC_LAT, NYC_LON);

      expect(result.cct).toBeGreaterThanOrEqual(2000);
      expect(result.cct).toBeLessThanOrEqual(6500);
      expect(result.intensity).toBeGreaterThanOrEqual(50); // 5% minimum
      expect(result.intensity).toBeLessThanOrEqual(1000);
    });
  });

  describe('Return value format', () => {
    it('should return rounded integer values', () => {
      const testDate = new Date('2024-06-21T12:00:00Z');
      const result = calculateCCT(NYC_LAT, NYC_LON, testDate);

      expect(Number.isInteger(result.cct)).toBe(true);
      expect(Number.isInteger(result.intensity)).toBe(true);
    });

    it('should have correct properties', () => {
      const testDate = new Date('2024-06-21T12:00:00Z');
      const result = calculateCCT(NYC_LAT, NYC_LON, testDate);

      expect(result).toHaveProperty('cct');
      expect(result).toHaveProperty('intensity');
      expect(typeof result.cct).toBe('number');
      expect(typeof result.intensity).toBe('number');
    });
  });

  describe('Intensity ranges', () => {
    const NYC_LAT = 40.7128;
    const NYC_LON = -74.006;

    it('intensity stays within [50, 1000] across a whole day (hourly samples)', () => {
      const base = new Date('2024-06-21T00:00:00Z'); // summer solstice
      for (let hour = 0; hour < 24; hour++) {
        const sample = new Date(base.getTime() + hour * 60 * 60 * 1000);
        const { intensity } = calculateCCT(NYC_LAT, NYC_LON, sample);
        expect(intensity).toBeGreaterThanOrEqual(50); // 5% minimum
        expect(intensity).toBeLessThanOrEqual(1000);
      }
    });

    it('intensity stays within range across seasons and locations (spot samples)', () => {
      const cases = [
        // Dates: solstices and equinoxes
        '2024-03-20T00:00:00Z', // vernal equinox
        '2024-06-21T00:00:00Z', // summer solstice
        '2024-09-22T00:00:00Z', // autumnal equinox
        '2024-12-21T00:00:00Z', // winter solstice
      ];

      const locations = [
        { name: 'NYC', lat: 40.7128, lon: -74.006 },
        { name: 'London', lat: 51.5074, lon: -0.1278 },
        { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
      ];

      const offsetsHours = [0, 6, 12, 18]; // midnight, morning, noon, evening (UTC)

      for (const iso of cases) {
        const base = new Date(iso);
        for (const { lat, lon } of locations) {
          for (const h of offsetsHours) {
            const d = new Date(base.getTime() + h * 60 * 60 * 1000);
            const { intensity } = calculateCCT(lat, lon, d);
            expect(intensity).toBeGreaterThanOrEqual(50); // 5% minimum
            expect(intensity).toBeLessThanOrEqual(1000);
          }
        }
      }
    });
  });
});
