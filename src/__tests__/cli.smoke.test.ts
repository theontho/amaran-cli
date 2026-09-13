import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_DIR_ENV } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = path.resolve(__dirname, '../../dist/cli.js');
const runBuiltCliTest = existsSync(cliPath) ? it : it.skip;

describe('CLI Smoke Test', () => {
  let configDir: string;

  beforeEach(() => {
    mkdirSync('.test-storage', { recursive: true });
    configDir = mkdtempSync(join(process.cwd(), '.test-storage', 'cli-smoke-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  runBuiltCliTest('should run built cli help without error', () => {
    const proc = spawnSync('node', [cliPath, '--help'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, [CONFIG_DIR_ENV]: configDir, FORCE_COLOR: '0' },
    });

    expect(proc.status).toBe(0);
    expect(proc.stdout).toMatch(/Usage|Help|Options/i);
    expect(proc.stdout).not.toContain('(dev)');
  });

  runBuiltCliTest('should run built cli help through a symlink', () => {
    const binPath = join(configDir, 'amaran-cli');
    symlinkSync(cliPath, binPath, 'file');

    const proc = spawnSync('node', [binPath, '--help'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, [CONFIG_DIR_ENV]: configDir, FORCE_COLOR: '0' },
    });

    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain('Usage: amaran-cli');
    expect(proc.stdout).not.toContain('(dev)');
  });

  runBuiltCliTest('documents direct BLE dashboard, import, lux, effects, and retargetable presets', () => {
    const help = (...args: string[]) =>
      spawnSync('node', [cliPath, ...args, '--help'], {
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, [CONFIG_DIR_ENV]: configDir, FORCE_COLOR: '0' },
      });

    const root = help();
    expect(root.status).toBe(0);
    expect(root.stdout).toContain('amaran-cli ble dashboard --open');
    expect(root.stdout).toContain('amaran-cli list --backend desktop');
    expect(root.stdout).toMatch(/^ {2}desktop\s/m);
    expect(root.stdout).not.toMatch(/^ {2}discover\s/m);
    expect(root.stdout).not.toMatch(/^ {2}firmware\s/m);
    expect(root.stdout).not.toContain('amaran-cli power on');

    const desktopCommands = help('desktop');
    expect(desktopCommands.stdout).toContain('desktop discover');
    expect(desktopCommands.stdout).toContain('desktop firmware update desk');
    expect(desktopCommands.stdout).toContain('explicitly require Amaran Desktop');

    const firmware = help('desktop', 'firmware', 'update');
    expect(firmware.stdout).toContain('always uses the Amaran Desktop backend');
    expect(firmware.stdout).not.toContain('Firmware is up to date');

    const dashboard = help('ble', 'dashboard');
    expect(dashboard.stdout).toContain('maxLuxByModel');
    expect(dashboard.stdout).toContain('loopback-only');
    expect(dashboard.stdout).toContain('interactive daily schedule');

    const desktop = help('ble', 'import-desktop');
    expect(desktop.stdout).toContain('Preview is the default');
    expect(desktop.stdout).toContain('Faulty Bulb');

    const effect = help('effect');
    expect(effect.stdout).toContain('frequency and animation speed are separate');
    expect(effect.stdout).toContain('"speed":4');

    const preset = help('preset');
    expect(preset.stdout).toContain('may be retargeted at recall');
  });
});
