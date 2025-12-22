import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import registerCommands from '../commands.js';
import type LightController from '../deviceControl/lightControl.js';

// Mock dependencies
vi.mock('../daylightSimulation/geoipUtil', () => ({
  getLocationFromIP: vi.fn(() => ({ ll: [37.7749, -122.4194] })),
}));

// Mock cctUtil to return predictable values
vi.mock('../daylightSimulation/cctUtil', () => ({
  calculateCCT: vi.fn(() => ({ cct: 5600, intensity: 500 })), // 500 = 50%
  parseCurveType: vi.fn(() => 'HANN'),
  CurveType: {
    HANN: 'hann',
  },
}));

// Mock constants to speed up simulation for tests
vi.mock('../constants', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    DEVICE_DEFAULTS: {
      updateInterval: 200, // 5 updates per second
      statusCheckDelay: 0,
    },
  };
});

describe('simulate-schedule command', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn();

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
    vi.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('runs simulation and calls setCCT', async () => {
    const setCCT = vi.fn();
    const disconnect = vi.fn(async () => Promise.resolve());

    const controllerStub = {
      getDevices: vi.fn(() => [{ node_id: '400J5-F2C008', device_name: 'Key Light' }]),
      getLightSleepStatus: vi.fn(),
      setCCT,
      disconnect,
    };

    const deps = {
      createController: async () => controllerStub as unknown as LightController,
      findDevice: (_controller: LightController, _deviceQuery: string) => ({
        node_id: '400J5-F2C008',
        device_name: 'Key Light',
      }),
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () => ({}) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    // Run simulation for 1 second with 200ms interval
    await program.parseAsync(['node', 'test', 'simulate-schedule', 'Key Light', '--duration', '1']);

    // Check that setCCT was called
    expect(setCCT).toHaveBeenCalled();
    const [nodeId, cct, intensity] = setCCT.mock.calls[0];
    expect(nodeId).toBe('400J5-F2C008');
    expect(cct).toBe(5600);
    expect(intensity).toBe(500); // Base intensity without multiplier

    expect(disconnect).toHaveBeenCalled();
  });
});
