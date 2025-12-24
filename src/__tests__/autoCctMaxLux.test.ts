import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import registerCommands from '../commands.js';
import type LightController from '../deviceControl/lightControl.js';

// Mock dependencies
vi.mock('../daylightSimulation/geoipUtil', () => ({
  getLocationFromIP: vi.fn(() => ({ ll: [37.7749, -122.4194] })),
}));

// We will mock cctUtil's return value individually in tests if needed,
// but here is a default mock factory
const mockCalculateCCT = vi.fn();
vi.mock('../daylightSimulation/cctUtil', () => ({
  calculateCCT: (...args: unknown[]) => mockCalculateCCT(...args),
  parseCurveType: vi.fn(() => 'HANN'),
  CurveType: {
    HANN: 'hann',
  },
}));

describe('auto-cct max-lux logic', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn();

  // Common stub setups
  const setCCT = vi.fn();
  const disconnect = vi.fn(async () => Promise.resolve());

  const controllerStub = {
    getDevices: vi.fn(() => [{ node_id: '400J5-F2C008', device_name: 'Test Light' }]),
    getLightSleepStatus: vi.fn(
      (_nodeId: string, cb: (success: boolean, msg: string, data?: { sleep: boolean }) => void) => {
        setImmediate(() => cb(true, 'ok', { sleep: false }));
      }
    ),
    setCCT,
    disconnect,
  };

  const createController = async () => controllerStub as unknown as LightController;
  const findDevice = (_controller: LightController, _deviceQuery: string): null => null;
  const asyncCommand =
    <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
    (...args: T) =>
      fn(...args);

  beforeAll(() => {
    mockFetch.mockImplementation(
      async () =>
        ({
          json: async () => ({ ip: '1.2.3.4' }),
        }) as unknown as Response
    );
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    mockFetch.mockClear();
    setCCT.mockClear();
    disconnect.mockClear();
    mockCalculateCCT.mockReset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('uses standard intensity when no max-lux provided', async () => {
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 500, lightOutput: 5000 }); // 50% intensity
    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({}) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct']);

    // Should use raw intensity: 500 (50.0%)
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 500);
  });

  test('uses max-lux scaling when CLI option provided', async () => {
    // We mock calculateCCT to return what we expect it to return when max-lux is 10000.
    // lightOutput 5000 lux. maxLux 10000. Should be 50% -> 500 raw.
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 500, lightOutput: 5000 });

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({}) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    // --max-lux 10000
    await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '10000']);

    // Check that calculateCCT was called with maxLux
    expect(mockCalculateCCT).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      expect.objectContaining({ maxLux: 10000 }),
      expect.any(String)
    );

    // Should use the intensity returned by the mock: 500 (50.0%)
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 500);
  });

  test('uses max-lux scaling from config', async () => {
    // lightOutput 2000 lux. maxLux 10000. Should be 20% -> 200 raw.
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 200, lightOutput: 2000 });

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({ maxLux: 10000 }) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct']);

    expect(mockCalculateCCT).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      expect.objectContaining({ maxLux: 10000 }),
      expect.any(String)
    );

    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 200);
  });

  test('CLI option overrides config for max-lux', async () => {
    // Config: 10000 maxLux. CLI: 5000 maxLux. LightOutput: 2500.
    // CLI should yield 50% -> 500 raw.
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 500, lightOutput: 2500 });

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({ maxLux: 10000 }) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '5000']);

    expect(mockCalculateCCT).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      expect.objectContaining({ maxLux: 5000 }),
      expect.any(String)
    );

    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 500);
  });

  test('falls back to intensity curve if lightOutput is missing', async () => {
    // No lightOutput in result
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 300 }); // 30%

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({}) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '10000']);

    // Should use the 30% intensity since lightOutput is missing
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 300);
  });

  test('clamps intensity to 100% if lux exceeds max-lux', async () => {
    // Output 15000, Max 10000 -> 150% -> clamped to 100% (in calculateCCT)
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 1000, lightOutput: 15000 });

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({}) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '10000']);

    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 1000); // 100%
  });

  test('respects intensityMin even when max-lux is set', async () => {
    // lightOutput 100 lux. maxLux 10000. Scaling gives 1%.
    // But intensityMin is 10%. Result should be 10% (100 raw).
    // The calculateCCT call should return 100.
    mockCalculateCCT.mockReturnValue({ cct: 5600, intensity: 100, lightOutput: 100 });

    const deps = {
      createController,
      findDevice,
      asyncCommand,
      loadConfig: () => ({ intensityMin: 10 }) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct', '--max-lux', '10000']);

    expect(mockCalculateCCT).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.any(Date),
      expect.objectContaining({ maxLux: 10000, intensityMinPct: 10 }),
      expect.any(String)
    );

    // Should be 100 (10.0%)
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 100);
  });
});
