import { Command } from 'commander';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import registerCommands from '../../commands.js';
import LightController from '../../deviceControl/lightControl.js';
import type { Device, LightController as LightControllerType } from '../../deviceControl/types.js';
import { MockLightServer } from '../../test/MockLightServer.js';

const TEST_PORT = 8091; // Use a different port to avoid conflicts
const WS_URL = `ws://localhost:${TEST_PORT}`;

describe('New CLI Commands Integration Tests', () => {
  let server: MockLightServer;

  beforeAll(async () => {
    server = new MockLightServer(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  beforeEach(() => {
    server.resetState();
    vi.clearAllMocks();
  });

  const createDeps = () => {
    const controller = new LightController(WS_URL, 'test-cli-new', undefined, false);
    return {
      createController: async () => {
        await new Promise<void>((resolve, reject) => {
          const ws = controller.getWebSocket();
          const fetchDevices = () => {
            controller.getDeviceList((success) => {
              if (success) resolve();
              else reject(new Error('Failed to fetch devices'));
            });
          };

          if (ws.readyState === 1) {
            fetchDevices();
          } else {
            ws.once('open', () => {
              setTimeout(fetchDevices, 50);
            });
            ws.once('error', reject);
            setTimeout(() => reject(new Error('Timeout connecting')), 2000);
          }
        });
        return controller;
      },
      findDevice: (ctrl: LightControllerType, deviceQuery: string) => {
        const devices = ctrl.getDevices();
        let device = devices.find((d: Device) => d.node_id === deviceQuery || d.id === deviceQuery);
        if (!device) {
          const q = deviceQuery.toLowerCase();
          device = devices.find((d: Device) => {
            const nm = (d.device_name || d.name || '').toLowerCase();
            return nm.includes(q);
          });
        }
        return device || null;
      },
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () => ({}),
      saveWsUrl: vi.fn(),
      saveConfig: vi.fn(),
    };
  };

  it('should list scenes', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'scene', 'list']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Mock server returns empty list by default, so "No scenes found"
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No scenes found'));
    consoleSpy.mockRestore();
  });

  it('should save a scene', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'scene', 'save', 'MyScene']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Scene "MyScene" saved successfully'));
    consoleSpy.mockRestore();
  });

  it('should recall a scene', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'scene', 'recall', 'scene-123']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Scene scene-123 recalled successfully'));
    consoleSpy.mockRestore();
  });

  it('should create a group', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'group', 'create', 'A']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Group "A" created successfully'));
    consoleSpy.mockRestore();
  });

  it('should set fan mode', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'fan', 'mode', '400J5-F2C008', '1']); // Mode 1
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Fan mode set to 1'));

    // Verify state in mock server
    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.fan_mode).toBe(1); // Args are typically strings via CLI, mock handles appropriately

    consoleSpy.mockRestore();
  });

  it('should set effect', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'effect', 'set', '400J5-F2C008', 'fire']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Effect fire set'));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.work_mode).toBe('EFFECT');
    expect(state?.effect_type).toBe('fire');

    consoleSpy.mockRestore();
  });

  it('should check firmware info', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'firmware', 'check', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Firmware Status'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Firmware is up to date'));

    consoleSpy.mockRestore();
  });

  it('should apply quickshot', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'quickshot', 'set', 'qs-999']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Quickshot qs-999 applied'));
    consoleSpy.mockRestore();
  });

  it('should recall preset', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {
      /* no-op */
    });

    await program.parseAsync(['node', 'test', 'preset', 'recall', '400J5-F2C008', 'p1']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Preset p1 recalled'));
    consoleSpy.mockRestore();
  });
});
