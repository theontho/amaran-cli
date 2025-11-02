import { jest } from '@jest/globals';
import { Command } from 'commander';
import registerCommands from '../commands';
import type LightController from '../lightControl';

jest.mock('../geoipUtil', () => ({
  getLocationFromIP: jest.fn(() => ({ ll: [37.7749, -122.4194] })),
}));

jest.mock('../cctUtil', () => ({
  calculateCCT: jest.fn(() => ({ cct: 5600, intensity: 500 })),
}));

describe('auto-cct command', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();

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
    const setCCT = jest.fn();
    const disconnect = jest.fn(async () => Promise.resolve());

    const sleepState: Record<string, boolean> = {
      '400J5-F2C008': false,
      '400J5-F2C009': true,
    };

    const controllerStub = {
      getDevices: jest.fn(() => [
        { node_id: '400J5-F2C008', device_name: 'On Light' },
        { node_id: '400J5-F2C009', device_name: 'Off Light' },
      ]),
      getLightSleepStatus: jest.fn(
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
});
