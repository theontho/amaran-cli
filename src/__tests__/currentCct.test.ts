import { describe, expect, it } from 'vitest';
import { calculateCurrentCCT } from '../daylightSimulation/currentCct.js';

describe('calculateCurrentCCT', () => {
  it('falls back without weather adjustments when auto weather lookup fails', async () => {
    const result = await calculateCurrentCCT(
      {
        lat: 40.7128,
        lon: -74.006,
        weather: true,
        time: new Date('2025-06-21T12:00:00-04:00'),
      },
      {
        getWeatherData: async () => {
          throw new Error('weather service unavailable');
        },
      }
    );

    expect(result.weatherSource).toBe('none');
    expect(result.weatherOptions).toBeUndefined();
    expect(result.weatherDataSource).toBe('auto-weather unavailable');
    expect(result.warnings).toContain(
      'Warning: Auto-weather unavailable (weather service unavailable). Continuing without weather adjustments.'
    );
  });
});
