import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  });
});
