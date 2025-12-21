import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import registerAutoCct from '../commands/daylightSimulation/autoCct.js';
import registerConfig from '../commands/deviceControl/config.js';
import { interpolateMaxLux, parseMaxLuxMap } from '../daylightSimulation/mathUtil.js';

describe('Max Lux Map Feature', () => {
  describe('Math Utils', () => {
    const map = {
      2700: 8000,
      5600: 10000,
      6500: 9000,
    };

    it('parses valid map string', () => {
      const result = parseMaxLuxMap('2700:8000, 5600:10000, 6500:9000');
      expect(result).toEqual(map);
    });

    it('returns null for invalid string', () => {
      expect(parseMaxLuxMap('invalid')).toBeNull();
      expect(parseMaxLuxMap('2700:abc')).toBeNull();
    });

    it('interpolates correctly within range', () => {
      // 4150 is exactly half way between 2700 and 5600.
      // 2700->8000, 5600->10000. Diff = 2000. Half = 1000. Result 9000.
      expect(interpolateMaxLux(4150, map)).toBeCloseTo(9000);
    });

    it('clamps to lower bound', () => {
      expect(interpolateMaxLux(2000, map)).toBe(8000);
    });

    it('clamps to upper bound', () => {
      expect(interpolateMaxLux(7000, map)).toBe(9000);
    });

    it('handles exact match', () => {
      expect(interpolateMaxLux(5600, map)).toBe(10000);
    });
  });

  describe('Config Command Integration', () => {
    it('saves parsed map to config', async () => {
      const program = new Command();
      program.exitOverride();
      const saveConfig = vi.fn();
      const deps = {
        asyncCommand:
          <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
          (...args: T) =>
            fn(...args),
        loadConfig: () => ({}),
        saveConfig,
      } as unknown as CommandDeps;

      registerConfig(program, deps);

      await program.parseAsync(['node', 'test', 'config', '--max-lux', '2700:8000,5600:10000']);

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          maxLux: { 2700: 8000, 5600: 10000 },
        }),
        expect.anything()
      );
    });
  });

  describe('AutoCCT Integration', () => {
    // Mock cctUtil to control the "current" CCT
    vi.mock('../daylightSimulation/cctUtil', () => ({
      calculateCCT: vi.fn(() => ({ cct: 4150, intensity: 500, lightOutput: 4500 })), // 4500 lux target
      parseCurveType: vi.fn(() => 'HANN'),
      CurveType: { HANN: 'hann' },
    }));

    vi.mock('../daylightSimulation/geoipUtil', () => ({
      getLocationFromIP: vi.fn(() => ({ ll: [0, 0] })),
    }));

    it('uses interpolated max lux for intensity calculation', async () => {
      const setCCT = vi.fn();
      const disconnect = vi.fn(async () => Promise.resolve());
      const controllerStub = {
        getDevices: () => [{ node_id: 'AAA-111' }],
        getLightSleepStatus: (_id: any, cb: any) => cb(true, 'ok', { sleep: false }),
        setCCT,
        disconnect,
      };

      const deps = {
        createController: async () => controllerStub,
        findDevice: () => null,
        asyncCommand:
          <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
          (...args: T) =>
            fn(...args),
        loadConfig: () => ({}),
      } as any;

      const program = new Command();
      program.exitOverride();
      registerAutoCct(program, deps);

      // Max Lux Map: 2700:8000, 5600:10000.
      // Target CCT from mock is 4150.
      // Interpolated Max Lux should be 9000 (midpoint).
      // Target Output is 4500.
      // Intensity should be 4500 / 9000 = 0.5 = 50%.
      // 50% * 10 = 500 raw intensity.

      await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '2700:8000,5600:10000']);

      expect(setCCT).toHaveBeenCalledWith('AAA-111', 4150, 500);
    });
  });
});
