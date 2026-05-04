import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const runBuiltPackageTest = existsSync(path.resolve(process.cwd(), 'dist/index.js')) ? it : it.skip;

describe('package exports', () => {
  runBuiltPackageTest('exposes public library entrypoints through package exports', () => {
    const proc = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
          const root = await import('amaran-light-cli');
          const deviceControl = await import('amaran-light-cli/device-control');
          const circadian = await import('amaran-light-cli/circadian');
          const commands = await import('amaran-light-cli/commands');
          const cli = await import('amaran-light-cli/cli');

          if (typeof root.LightController !== 'function') throw new Error('missing root LightController');
          if (typeof deviceControl.LightController !== 'function') throw new Error('missing device-control LightController');
          if (typeof circadian.calculateCCT !== 'function') throw new Error('missing circadian calculateCCT');
          if (typeof circadian.ScheduleMaker !== 'function') throw new Error('missing circadian ScheduleMaker');
          if (typeof commands.registerCommands !== 'function') throw new Error('missing commands registerCommands');
          if (typeof cli.program !== 'object') throw new Error('missing cli program');
        `,
      ],
      {
        encoding: 'utf8',
        timeout: 10000,
      }
    );

    expect(proc.status).toBe(0);
    expect(proc.stderr).toBe('');
  });
});
