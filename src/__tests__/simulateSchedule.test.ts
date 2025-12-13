import { Command } from 'commander';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import registerCommands from '../commands';
import type LightController from '../lightControl';

// Mock dependencies
vi.mock('../geoipUtil', () => ({
  getLocationFromIP: vi.fn(() => ({ ll: [37.7749, -122.4194] })),
}));

// Mock cctUtil to return predictable values
vi.mock('../cctUtil', () => ({
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

  test('applies intensity multiplier during simulation', async () => {
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
      loadConfig: () =>
        ({
          intensityMultiplier: {
            '400J5-F2C008': 0.5, // 50% multiplier
          },
        }) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    // Run simulation for 1 second with 200ms interval = 5 updates (plus one initial?)
    await program.parseAsync(['node', 'test', 'simulate-schedule', 'Key Light', '--duration', '1']);

    // Check that setCCT was called
    expect(setCCT).toHaveBeenCalled();

    // Verify the intensity was scaled
    // Base intensity is 500 (50%). Multiplier is 0.5.
    // Target percent = 25%.
    // Raw intensity = 500 * (25/50) = 250.
    const calls = setCCT.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // Check key parameters of the first call
    const [nodeId, cct, intensity] = calls[0];
    expect(nodeId).toBe('400J5-F2C008');
    expect(cct).toBe(5600);
    expect(intensity).toBe(250); // 500 * 0.5

    expect(disconnect).toHaveBeenCalled();
  });
});
