import { Command } from 'commander';
import registerCommands from '../commands';

describe('CLI intensity API usage (0-100 -> 0-1000)', () => {
  function buildProgram(capture: any) {
    const program = new Command();
    program.exitOverride();

    const mockController: any = {
      setIntensityForAllLights: (intensity: number, cb?: Function) => {
        capture.intensityForAll = intensity;
        cb?.(true, 'ok');
        return Promise.resolve();
      },
      setIntensity: (nodeId: string, intensity: number, cb?: Function) => {
        capture.intensityOne = { nodeId, intensity };
        cb?.(true, 'ok');
      },
      setCCTForAllLights: (cct: number, intensity?: number, cb?: Function) => {
        capture.cctForAll = { cct, intensity };
        cb?.(true, 'ok');
        return Promise.resolve();
      },
      setHSIForAllLights: (
        h: number,
        s: number,
        i: number,
        _c?: number,
        _g?: number,
        cb?: Function
      ) => {
        capture.hsiForAll = { h, s, i };
        cb?.(true, 'ok');
        return Promise.resolve();
      },
      setColorForAllLights: (color: string, intensity?: number, cb?: Function) => {
        capture.colorForAll = { color, intensity };
        cb?.(true, 'ok');
        return Promise.resolve();
      },
      disconnect: () => Promise.resolve(),
      getDevices: () => [{ node_id: 'DEV-1', device_name: 'Mock Light' }],
      turnOnAllLights: () => Promise.resolve(),
      turnOffAllLights: () => Promise.resolve(),
      toggleAllLights: () => Promise.resolve(),
    };

    const deps = {
      createController: async () => mockController,
      findDevice: (_controller: any, _query: string) => ({
        node_id: 'DEV-1',
        device_name: 'Mock Light',
      }),
      asyncCommand:
        (fn: any) =>
        (...args: any[]) =>
          fn(...args),
      saveWsUrl: undefined,
      loadConfig: undefined,
    };

    registerCommands(program, deps);
    return program;
  }

  test('intensity command maps percent to 0-1000 for all devices', async () => {
    const capture: any = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'intensity', '25', 'all']);
    expect(capture.intensityForAll).toBe(250);
  });

  test('intensity command boundaries 0% => 0 and 100% => 1000', async () => {
    const capture: any = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'intensity', '0', 'all']);
    expect(capture.intensityForAll).toBe(0);
    const capture2: any = {};
    const program2 = buildProgram(capture2);
    await program2.parseAsync(['node', 'test', 'intensity', '100', 'all']);
    expect(capture2.intensityForAll).toBe(1000);
  });

  test('cct --intensity maps percent to API range', async () => {
    const capture: any = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'cct', '3000', '--intensity', '30', 'all']);
    expect(capture.cctForAll).toEqual({ cct: 3000, intensity: 300 });
  });

  test('hsi intensity argument maps percent to API range', async () => {
    const capture: any = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'hsi', '120', '50', '40', 'all']);
    expect(capture.hsiForAll).toEqual({ h: 120, s: 50, i: 400 });
  });

  test('color --intensity maps percent to API range', async () => {
    const capture: any = {};
    const program = buildProgram(capture);
    await program.parseAsync(['node', 'test', 'color', 'red', '--intensity', '12', 'all']);
    expect(capture.colorForAll).toEqual({ color: 'red', intensity: 120 });
  });
});
