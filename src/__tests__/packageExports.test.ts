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
          const amaranLights = await import('amaran-light-cli/amaran-lights');
          const deviceControl = await import('amaran-light-cli/device-control');
          const circadianSim = await import('amaran-light-cli/circadianSim');
          const circadianSimAlias = await import('amaran-light-cli/circadiansim');
          const circadian = await import('amaran-light-cli/circadian');
          const commands = await import('amaran-light-cli/commands');
          const cli = await import('amaran-light-cli/cli');

          if (typeof root.LightController !== 'function') throw new Error('missing root LightController');
          if (typeof root.amaranLights.LightController !== 'function') throw new Error('missing root amaranLights namespace');
          if (typeof root.circadianSim.calculateCCT !== 'function') throw new Error('missing root circadianSim namespace');
          if (typeof amaranLights.LightController !== 'function') throw new Error('missing amaran-lights LightController');
          if (typeof deviceControl.LightController !== 'function') throw new Error('missing device-control LightController');
          if (typeof circadianSim.calculateCCT !== 'function') throw new Error('missing circadiansim calculateCCT');
          if (typeof circadianSim.graphSchedule !== 'function') throw new Error('missing circadiansim graphSchedule');
          if (typeof circadianSim.textSchedule !== 'function') throw new Error('missing circadiansim textSchedule');
          if (typeof circadianSimAlias.calculateCCT !== 'function') throw new Error('missing circadiansim alias calculateCCT');
          if (typeof circadian.calculateCCT !== 'function') throw new Error('missing circadian calculateCCT');
          if (typeof circadian.ScheduleMaker !== 'function') throw new Error('missing circadian ScheduleMaker');
          if (typeof commands.registerCommands !== 'function') throw new Error('missing commands registerCommands');
          if (typeof commands.registerDeviceControlCommands !== 'function') throw new Error('missing commands registerDeviceControlCommands');
          if (typeof commands.registerCircadianSimCommands !== 'function') throw new Error('missing commands registerCircadianSimCommands');
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
