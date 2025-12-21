import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import registerConfig from '../commands/deviceControl/config.js';
import type { CommandDeps } from '../deviceControl/types.js';

describe('config command max-lux', () => {
  it('should save max-lux when valid number provided', async () => {
    const program = new Command();
    program.exitOverride();
    const saveConfig = vi.fn();
    const deps = {
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () => ({}),
      saveConfig,
    } as unknown as CommandDeps;

    registerConfig(program, deps);

    await program.parseAsync(['node', 'test', 'config', '--max-lux', '10000']);

    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ maxLux: 10000 }),
      expect.arrayContaining([expect.stringContaining('Max Lux: 10000')])
    );
  });

  it('should error when max-lux is not a positive number', async () => {
    const program = new Command();
    program.exitOverride();
    const saveConfig = vi.fn();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* no-op */
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`Process exit: ${code}`);
    }) as unknown as (code?: number | string | null) => never);

    const deps = {
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () => ({}),
      saveConfig,
    } as unknown as CommandDeps;

    registerConfig(program, deps);

    // Test non-number
    await expect(program.parseAsync(['node', 'test', 'config', '--max-lux', 'invalid'])).rejects.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('max-lux must be a positive number'));

    // Test negative number
    await expect(program.parseAsync(['node', 'test', 'config', '--max-lux', '-100'])).rejects.toThrow();

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
