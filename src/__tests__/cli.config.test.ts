import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_DIR_ENV } from '../config.js';

function runCli(args: string[], configDir: string) {
  return spawnSync('npx', ['tsx', 'src/cli.ts', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      [CONFIG_DIR_ENV]: configDir,
      FORCE_COLOR: '0',
      NODE_ENV: 'test',
    },
  });
}

describe('CLI config integration', () => {
  let configDir: string;
  let configPath: string;

  beforeEach(() => {
    mkdirSync('.test-storage', { recursive: true });
    configDir = mkdtempSync(join(process.cwd(), '.test-storage', 'cli-config-'));
    configPath = join(configDir, 'config.json');
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('shows help output', () => {
    const proc = runCli(['--help'], configDir);

    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain('Amaran Light Control CLI - v');
    expect(proc.stdout).toContain('(dev)');
    expect(proc.stdout).toContain('Usage: amaran-cli');
  });

  it('shows version output', () => {
    const proc = runCli(['--version'], configDir);

    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('saves configuration to an isolated platform config file', () => {
    const proc = runCli(['config', '--lat', '37.7749', '--lon', '-122.4194', '--debug', 'true'], configDir);

    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain('Configuration saved successfully');
    expect(existsSync(configPath)).toBe(true);

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.latitude).toBe(37.7749);
    expect(config.longitude).toBe(-122.4194);
    expect(config.debug).toBe(true);
  });

  it('saves BLE backend configuration', () => {
    const proc = runCli(
      ['config', '--backend', 'ble', '--ble-url', 'http://localhost:2708', '--ble-api-key', 'test-key'],
      configDir
    );

    expect(proc.status).toBe(0);
    expect(proc.stdout).toContain('Backend: ble');
    expect(proc.stdout).toContain('BLE HTTP URL: http://localhost:2708');
    expect(proc.stdout).toContain('BLE HTTP API key: configured');

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.backend).toBe('ble');
    expect(config.bleUrl).toBe('http://localhost:2708');
    expect(config.bleApiKey).toBe('test-key');
  });

  it('fails fast on invalid persisted configuration', () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ latitude: 200 }));

    const proc = runCli(['config', '--show'], configDir);

    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('Failed to load config');
  });

  it('exits non-zero when config save fails', () => {
    rmSync(configDir, { recursive: true, force: true });
    writeFileSync(configDir, 'not a directory');

    const proc = runCli(['config', '--debug', 'true'], configDir);

    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain('Error saving configuration');
  });
});
