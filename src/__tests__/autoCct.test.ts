import { Command } from 'commander';
import { vi } from 'vitest';
import registerCommands from '../commands.js';
import type LightController from '../lightControl.js';

vi.mock('../geoipUtil', () => ({
  getLocationFromIP: vi.fn(() => ({ ll: [37.7749, -122.4194] })),
}));

vi.mock('../cctUtil', () => ({
  calculateCCT: vi.fn(() => ({ cct: 5600, intensity: 500 })),
  parseCurveType: vi.fn(() => 'HANN'),
  CurveType: {
    HANN: 'hann',
    WIDER_MIDDLE_SMALL: 'wider-middle-small',
    WIDER_MIDDLE_MEDIUM: 'wider-middle-medium',
    WIDER_MIDDLE_LARGE: 'wider-middle-large',
    CIE_DAYLIGHT: 'cie-daylight',
    SUN_ALTITUDE: 'sun-altitude',
    PEREZ_DAYLIGHT: 'perez-daylight',
  },
}));

describe('auto-cct command', () => {
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
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('skips sleeping lights when running auto-cct', async () => {
    const setCCT = vi.fn();
    const disconnect = vi.fn(async () => Promise.resolve());

    const sleepState: Record<string, boolean> = {
      '400J5-F2C008': false,
      '400J5-F2C009': true,
    };

    const controllerStub = {
      getDevices: vi.fn(() => [
        { node_id: '400J5-F2C008', device_name: 'On Light' },
        { node_id: '400J5-F2C009', device_name: 'Off Light' },
      ]),
      getLightSleepStatus: vi.fn(
        (nodeId: string, cb: (success: boolean, msg: string, data?: { sleep: boolean }) => void) => {
          setImmediate(() => cb(true, 'ok', { sleep: sleepState[nodeId] }));
        }
      ),
      setCCT,
      disconnect,
    };

    const deps = {
      createController: async () => controllerStub as unknown as LightController,
      findDevice: (_controller: LightController, _deviceQuery: string): null => null,
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

    await program.parseAsync(['node', 'test', 'auto-cct']);

    expect(setCCT).toHaveBeenCalledTimes(1);
    // auto-cct should pass through calculateCCT result
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 500);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test('applies intensity multiplier from config', async () => {
    const setCCT = vi.fn();
    const disconnect = vi.fn(async () => Promise.resolve());

    const controllerStub = {
      getDevices: vi.fn(() => [
        { node_id: '400J5-F2C008', device_name: 'Key Light' },
        { node_id: '400J5-F2C009', device_name: 'Fill Light' },
      ]),
      getLightSleepStatus: vi.fn(
        (_nodeId: string, cb: (success: boolean, msg: string, data?: { sleep: boolean }) => void) => {
          setImmediate(() => cb(true, 'ok', { sleep: false }));
        }
      ),
      setCCT,
      disconnect,
    };

    const deps = {
      createController: async () => controllerStub as unknown as LightController,
      findDevice: (_controller: LightController, _deviceQuery: string): null => null,
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () =>
        ({
          intensityMultiplier: {
            '400J5-F2C008': 0.5, // 50% multiplier
            // 400J5-F2C009 has no multiplier, defaults to 1.0
          },
        }) as Record<string, unknown>,
      saveWsUrl: undefined,
    };

    const program = new Command();
    program.exitOverride();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'auto-cct']);

    expect(setCCT).toHaveBeenCalledTimes(2);
    // 5600K at 50% intensity (base 500 * 0.5 = 250)
    // Note: The logic in autoCct computes percent first, then multiplies.
    // Base intensity 500 -> 50%. 50% * 0.5 = 25%.
    // Then it converts back to raw intensity: 500 * (25 / 50) = 250.
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 250);
    // Normal intensity for the other light
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C009', 5600, 500);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  test('targets specific device when argument is provided', async () => {
    const setCCT = vi.fn();
    const disconnect = vi.fn(async () => Promise.resolve());

    const targetDevice = { node_id: '400J5-F2C008', device_name: 'Target Light' };
    const otherDevice = { node_id: '400J5-F2C009', device_name: 'Other Light' };

    const controllerStub = {
      getDevices: vi.fn(() => [targetDevice, otherDevice]),
      getLightSleepStatus: vi.fn(
        (_nodeId: string, cb: (success: boolean, msg: string, data?: { sleep: boolean }) => void) => {
          setImmediate(() => cb(true, 'ok', { sleep: false }));
        }
      ),
      setCCT,
      disconnect,
    };

    const findDeviceMock = vi.fn((_controller: LightController, query: string) => {
      if (query === 'Target') return targetDevice;
      return null;
    });

    const deps = {
      createController: async () => controllerStub as unknown as LightController,
      findDevice: findDeviceMock as unknown as (
        controller: LightController,
        deviceQuery: string
      ) => Record<string, unknown> | null,
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

    await program.parseAsync(['node', 'test', 'auto-cct', 'Target']);

    expect(findDeviceMock).toHaveBeenCalledWith(controllerStub, 'Target');
    expect(setCCT).toHaveBeenCalledTimes(1);
    expect(setCCT).toHaveBeenCalledWith('400J5-F2C008', 5600, 500);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
