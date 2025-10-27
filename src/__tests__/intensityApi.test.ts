import { Command } from 'commander';
import registerCommands from '../commands';
import type { Device, LightController } from '../types';

interface CaptureData {
  intensityForAll?: number;
  intensityOne?: { nodeId: string; intensity: number };
  cctForAll?: { cct: number; intensity?: number };
  hsiForAll?: { h: number; s: number; i: number };
  colorForAll?: { color: string; intensity?: number };
}

interface MockController {
  setIntensityForAllLights: (
    intensity: number,
    cb?: (success: boolean, message: string) => void
  ) => Promise<void>;
  setIntensity: (
    nodeId: string,
    intensity: number,
    cb?: (success: boolean, message: string) => void
  ) => void;
  setCCTAndIntensityForAllLights: (
    cct: number,
    intensity?: number,
    cb?: (success: boolean, message: string) => void
  ) => Promise<void>;
  setHSIForAllLights: (
    h: number,
    s: number,
    i: number,
    c?: number,
    g?: number,
    cb?: (success: boolean, message: string) => void
  ) => Promise<void>;
  setColorForAllLights: (
    color: string,
    intensity?: number,
    cb?: (success: boolean, message: string) => void
  ) => Promise<void>;
  disconnect: () => Promise<void>;
  getDevices: () => Array<{ node_id: string; device_name: string }>;
  turnOnAllLights: () => Promise<void>;
  turnOffAllLights: () => Promise<void>;
  toggleAllLights: () => Promise<void>;
}

describe('CLI intensity API usage (0-100 -> 0-1000)', () => {
  function buildProgram(capture: CaptureData) {
    const program = new Command();
    program.exitOverride();

    const mockController: MockController = {
      setIntensityForAllLights: async (
        intensity: number,
        cb?: (success: boolean, message: string) => void
      ) => {
        capture.intensityForAll = intensity;
        if (cb) {
          cb(true, 'ok');
        }
      },
      setIntensity: (
        nodeId: string,
        intensity: number,
        cb?: (success: boolean, message: string) => void
      ) => {
        capture.intensityOne = { nodeId, intensity };
        if (cb) {
          cb(true, 'ok');
        }
      },
      setCCTAndIntensityForAllLights: async (
        cct: number,
        intensity?: number,
        cb?: (success: boolean, message: string) => void
      ) => {
        capture.cctForAll = { cct, intensity };
        if (cb) {
          cb(true, 'ok');
        }
      },
      setHSIForAllLights: async (
        h: number,
        s: number,
        i: number,
        _c?: number,
        _g?: number,
        cb?: (success: boolean, message: string) => void
      ) => {
        capture.hsiForAll = { h, s, i };
        if (cb) {
          cb(true, 'ok');
        }
      },
      setColorForAllLights: async (
        color: string,
        intensity?: number,
        cb?: (success: boolean, message: string) => void
      ) => {
        capture.colorForAll = { color, intensity };
        if (cb) {
          cb(true, 'ok');
        }
      },
      disconnect: async () => {
        // No-op for tests
      },
      getDevices: () => [{ node_id: 'DEV-1', device_name: 'Mock Light' }],
      turnOnAllLights: async () => {
        // No-op for tests
      },
      turnOffAllLights: async () => {
        // No-op for tests
      },
      toggleAllLights: async () => {
        // No-op for tests
      },
    };

    const deps = {
      createController: async () => mockController as unknown as LightController,
      findDevice: (_controller: unknown, _query: string): Device | null => ({
        node_id: 'DEV-1',
        device_name: 'Mock Light',
      }),
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      saveWsUrl: undefined,
      loadConfig: undefined,
    };

    registerCommands(program, deps);
    return program;
  }

  test('intensity command maps percent to 0-1000 for all devices', async () => {
    const capture: CaptureData = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'intensity', '25', 'all']);
    expect(capture.intensityForAll).toBe(250);
  });

  test('intensity command boundaries 0% => 0 and 100% => 1000', async () => {
    const capture: CaptureData = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'intensity', '0', 'all']);
    expect(capture.intensityForAll).toBe(0);
    const capture2: CaptureData = {};
    const program2 = buildProgram(capture2);
    await program2.parseAsync(['node', 'test', 'intensity', '100', 'all']);
    expect(capture2.intensityForAll).toBe(1000);
  });

  test('cct --intensity maps percent to API range', async () => {
    const capture: CaptureData = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'cct', '3000', '--intensity', '30', 'all']);
    expect(capture.cctForAll).toEqual({ cct: 3000, intensity: 300 });
  });

  test('hsi intensity argument maps percent to API range', async () => {
    const capture: CaptureData = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'hsi', '120', '50', '40', 'all']);
    expect(capture.hsiForAll).toEqual({ h: 120, s: 50, i: 400 });
  });

  test('color --intensity maps percent to API range', async () => {
    const capture: CaptureData = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'color', 'red', '--intensity', '12', 'all']);
    expect(capture.colorForAll).toEqual({ color: 'red', intensity: 120 });
  });
});
