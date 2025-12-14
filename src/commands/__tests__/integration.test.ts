import { Command } from 'commander';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import registerCommands from '../../commands.js';
import LightController from '../../lightControl.js';
import { MockLightServer } from '../../test/MockLightServer.js';
import type { LightController as LightControllerType } from '../../types.js';

const TEST_PORT = 8090;
const WS_URL = `ws://localhost:${TEST_PORT}`;

describe('CLI Integration Tests', () => {
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
  });

  const createDeps = () => {
    const controller = new LightController(WS_URL, 'test-cli', undefined, false);
    // Mock the disconnect to not actually close the socket immediately if needed,
    // or arguably we DO want it to close to test the CLI behavior.
    // The CLI calls disconnect() at the end.
    // If we want to check state after, we should ensure the COMMAND has finished,
    // and the server state should persist even if client disconnects.

    return {
      createController: async () => {
        // Wait for connection and device list
        await new Promise<void>((resolve, reject) => {
          const ws = controller.getWebSocket();

          // If already open, just fetch list
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
              // small delay to let onConnectionOpen trigger if needed, or just manual fetch
              setTimeout(fetchDevices, 50);
            });
            ws.once('error', reject);
            setTimeout(() => reject(new Error('Timeout connecting to mock server')), 2000);
          }
        });

        return controller;
      },
      findDevice: (ctrl: LightControllerType, deviceQuery: string) => {
        const devices = ctrl.getDevices();
        let device = devices.find((d: any) => d.node_id === deviceQuery || d.id === deviceQuery);
        if (!device) {
          const q = deviceQuery.toLowerCase();
          device = devices.find((d: any) => {
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
      // We throw instead of process.exit for tests?
      // Real asyncCommand does process.exit(1) on failure.
      // We probably want to keep that or mock it.
      // If we want to capture errors, we might mock process.exit.
      loadConfig: () => ({}),
      saveWsUrl: vi.fn(),
      saveConfig: vi.fn(),
    };
  };

  it('should turn on a light via power command', async () => {
    const program = new Command();
    program.exitOverride(); // Throw instead of exit
    const deps = createDeps();
    registerCommands(program, deps);

    // Capture console output
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'on', '400J5-F2C008']);
    // Wait for async command to complete (single device commands in CLI are not awaited)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.sleep).toBe(false); // On = sleep false
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('turned on'));

    consoleSpy.mockRestore();
  });

  it('should turn off a light via power command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    // Set initial state to ON (sleep false)
    // Actually default is On (sleep false) in our mock server?
    // Wait, MockLightServer: sleep: false by default.
    // So "Off" should make sleep: true.

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'off', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.sleep).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('turned off'));

    consoleSpy.mockRestore();
  });

  it('should set intensity via intensity command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'intensity', '50', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    // CLI takes 0-100, converts to 0-1000?
    // Let's check src/commands/intensity.ts.
    // Usually invalid args might fail, assuming 50 means 50% = 500
    expect(state?.intensity).toBe(500);

    consoleSpy.mockRestore();
  });

  it('should set CCT via cct command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'cct', '5600', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.cct).toBe(5600);
    expect(state?.work_mode).toBe('CCT');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('set to 5600K'));

    consoleSpy.mockRestore();
  });

  it('should set CCT and intensity via cct command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'cct', '3200', '-i', '80', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.cct).toBe(3200);
    expect(state?.intensity).toBe(800); // 80% = 800
    expect(state?.work_mode).toBe('CCT');
  });

  it('should set HSI via hsi command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    await program.parseAsync(['node', 'test', 'hsi', '240', '100', '50', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.hue).toBe(240);
    expect(state?.sat).toBe(100);
    expect(state?.intensity).toBe(500); // 50% = 500
    expect(state?.work_mode).toBe('HSI');
  });

  it('should send Set Color command via color command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    // The CLI converts color name to something?
    // Actually src/commands/color.ts simply calls controller.setColor
    // which mock server just logs/acks but doesn't change state much unless we parse it.
    // The MockLightServer currently doesn't update specific state for setColor,
    // but the command logic should proceed and succeed.

    // Check if color command throws
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'color', 'red', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('color set to red'));
    consoleSpy.mockRestore();
  });

  it('should list all devices via list command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'list']);
    // No async wait needed as list doesn't have an async device operation after the initial fetch which createController handles?
    // Wait, list does createController -> getDevices (sync on client side) -> log -> disconnect.
    // createController does async fetch.

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Light 1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Test Light 2'));
    consoleSpy.mockRestore();
  });

  it('should show status for a device via status command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Ensure some known state
    server.resetState();
    // Default: sleep false (On), 0 intensity, 3200K

    await program.parseAsync(['node', 'test', 'status', '400J5-F2C008']);
    await new Promise((resolve) => setTimeout(resolve, 100)); // status fetches sleep status async

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Status for Test Light 1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('State: On'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Intensity: 0%'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Temperature: 3200K')); // Default in mock

    consoleSpy.mockRestore();
  });

  it('should run auto-cct command and update lights', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    registerCommands(program, deps);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Ensure we have devices via reset
    server.resetState();

    // Run auto-cct with explicit location/time to avoid external factors
    // Use Summer Solstice noon to ensure high CCT (Winter noon is lower due to solar altitude)
    await program.parseAsync([
      'node',
      'test',
      'auto-cct',
      '--lat',
      '40.7128',
      '--lon',
      '-74.0060',
      '--time',
      '2025-06-21T12:00:00',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // At noon it should be cool (6500K)
    const state = server.getDeviceState('400J5-F2C008');
    // Expect CCT to be changed.
    expect(state?.cct).toBeGreaterThan(5000);
    expect(state?.intensity).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('should save and list config via config command', async () => {
    const program = new Command();
    program.exitOverride();
    const deps = createDeps();
    // Spy on saveConfig
    const saveConfigSpy = vi.fn();
    deps.saveConfig = saveConfigSpy;

    registerCommands(program, deps);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Set config
    await program.parseAsync(['node', 'test', 'config', '--cct-min', '2500']);
    expect(saveConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ cctMin: 2500 }), expect.anything());

    // Show config
    await program.parseAsync(['node', 'test', 'config', '--show']);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Current configuration:'));

    consoleSpy.mockRestore();
  });
});
