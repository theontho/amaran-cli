import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as circadian from '../circadian.js';

function collectTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return collectTypeScriptFiles(fullPath);
    return fullPath.endsWith('.ts') ? [fullPath] : [];
  });
}

describe('circadian module isolation', () => {
  it('does not import command or device-control internals', () => {
    const moduleDir = path.resolve(process.cwd(), 'src/daylightSimulation');
    const files = collectTypeScriptFiles(moduleDir);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"](?:\.\.\/)+(?:commands|deviceControl)\//);
    }
  });

  it('exposes reusable calculation, schedule, text, and graph APIs', () => {
    expect(circadian.calculateCurrentCCT).toBeTypeOf('function');
    expect(circadian.ScheduleMaker).toBeTypeOf('function');
    expect(circadian.textSchedule).toBeTypeOf('function');
    expect(circadian.graphSchedule).toBeTypeOf('function');
  });
});
