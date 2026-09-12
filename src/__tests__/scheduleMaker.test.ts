import { describe, expect, it } from 'vitest';
import { ScheduleMaker } from '../daylightSimulation/scheduleMaker.js';

describe('ScheduleMaker', () => {
  it('uses CIE daylight when no curve is specified', async () => {
    const schedule = await new ScheduleMaker().makeSchedule({
      lat: '40.7128',
      lon: '-74.006',
      date: '2025-06-21',
      intervalMinutes: 120,
    });

    expect(schedule.curves).toEqual(['CIE_DAYLIGHT']);
  });

  it('uses CIE daylight when the configured default is invalid', async () => {
    const schedule = await new ScheduleMaker({
      loadConfig: () => ({ defaultCurve: 'invalid' }),
    }).makeSchedule({
      lat: '40.7128',
      lon: '-74.006',
      date: '2025-06-21',
      intervalMinutes: 120,
    });

    expect(schedule.curves).toEqual(['CIE_DAYLIGHT']);
  });
});
