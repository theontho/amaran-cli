import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import { vi } from 'vitest';
import { handleAutostart, isAmaranAppRunning, startAmaranApp } from '../deviceControl/autostart.js';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

// Mock the child_process module
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => fn),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('chalk', () => {
  const mocks = {
    yellow: vi.fn((text) => text),
    green: vi.fn((text) => text),
    gray: vi.fn((text) => text),
    red: vi.fn((text) => text),
    blue: vi.fn((text) => text),
  };
  return { default: mocks };
});

describe('autostart', () => {
  // The imported 'exec' and 'fs' are already the mocked versions due to vi.mock calls.
  // We use vi.mocked() to get the typed mock objects.
  const mockExec = vi.mocked(exec);
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {
      // no-op
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {
      // no-op
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isAmaranAppRunning', () => {
    it('should return true when amaran process is found', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((_command, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as ExecCallback;
        callback(
          null,
          'amaran Desktop 12345 0.0  0.1  123456  1234 ??  10:30AM 0:00.01 /Applications/amaran Desktop.app/Contents/MacOS/amaran Desktop',
          ''
        );
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('ps aux | grep -i "amaran desktop" | grep -v grep', expect.any(Function));
    });

    it('should return false when no amaran process is found', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((_command, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as ExecCallback;
        callback(null, '', '');
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(false);
    });

    it('should return false when exec fails', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((_command, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as ExecCallback;
        callback(new Error('Command failed'), '', '');
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(false);
    });
  });

  describe('startAmaranApp', () => {
    it('should start app successfully when autostart is enabled', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((command: string, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function');
        if (command.includes('open -a "amaran Desktop"')) {
          callback(null, '', '');
        }
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ autoStartApp: true }));

      const promise = startAmaranApp(true);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('open -a "amaran Desktop" 2>/dev/null', expect.any(Function));
    });

    it('should not start app when autostart is disabled', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ autoStartApp: false }));

      const result = await startAmaranApp(true);

      expect(result).toBe(false);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('should try multiple start methods', async () => {
      let callCount = 0;
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((_command, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function') as ExecCallback;
        callCount++;
        if (callCount < 3) {
          callback(new Error('Command not found'), '', '');
        } else {
          callback(null, '', '');
        }
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const promise = startAmaranApp(true);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledTimes(3);
    });
  });

  describe('handleAutostart', () => {
    it('should return false when autostart is disabled', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ autoStartApp: false }));

      const result = await handleAutostart(true);

      expect(result).toBe(false);
    });

    it('should return true when app is already running', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((command: string, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function');
        if (command.includes('ps aux')) {
          callback(
            null,
            'amaran Desktop 12345 0.0  0.1  123456  1234 ??  10:30AM 0:00.01 /Applications/amaran Desktop.app/Contents/MacOS/amaran Desktop',
            ''
          );
        }
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = await handleAutostart(true);

      expect(result).toBe(true);
    });

    it('should attempt to start app when not running', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: mocking overloaded function
      mockExec.mockImplementation((command: string, ...args: any[]) => {
        const callback = args.find((arg) => typeof arg === 'function');
        if (command.includes('ps aux')) {
          callback(null, '', '');
        } else if (command.includes('open -a "amaran Desktop"')) {
          callback(null, '', '');
        }
        // biome-ignore lint/suspicious/noExplicitAny: mock return
        return {} as any;
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const promise = handleAutostart(true);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe(true);
    });
  });
});
