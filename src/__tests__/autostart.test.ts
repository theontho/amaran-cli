import { handleAutostart, isAmaranAppRunning, startAmaranApp } from '../autostart';

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

// Mock the child_process module
jest.mock('node:util', () => ({
  promisify: jest.fn((fn) => fn),
}));

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
}));

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
}));

jest.mock('chalk', () => ({
  yellow: jest.fn((text) => text),
  green: jest.fn((text) => text),
  gray: jest.fn((text) => text),
  red: jest.fn((text) => text),
  blue: jest.fn((text) => text),
}));

describe('autostart', () => {
  const mockExec = require('node:child_process').exec;
  const mockFs = require('node:fs');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isAmaranAppRunning', () => {
    it('should return true when amaran process is found', async () => {
      mockExec.mockImplementation((_command: string, callback: ExecCallback) => {
        callback(
          null,
          'amaran Desktop 12345 0.0  0.1  123456  1234 ??  10:30AM 0:00.01 /Applications/amaran Desktop.app/Contents/MacOS/amaran Desktop',
          ''
        );
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('ps aux | grep -i "amaran desktop" | grep -v grep', expect.any(Function));
    });

    it('should return false when no amaran process is found', async () => {
      mockExec.mockImplementation((_command: string, callback: ExecCallback) => {
        callback(null, '', '');
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(false);
    });

    it('should return false when exec fails', async () => {
      mockExec.mockImplementation((_command: string, callback: ExecCallback) => {
        callback(new Error('Command failed'), '', '');
      });

      const result = await isAmaranAppRunning(true);

      expect(result).toBe(false);
    });
  });

  describe('startAmaranApp', () => {
    it('should start app successfully when autostart is enabled', async () => {
      mockExec.mockImplementation((command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        if (command.includes('open -a "amaran Desktop"')) {
          callback(null, '', '');
        }
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ autoStartApp: true }));

      const result = await startAmaranApp(true);

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
      mockExec.mockImplementation((_command: string, callback: ExecCallback) => {
        callCount++;
        if (callCount < 3) {
          callback(new Error('Command not found'), '', '');
        } else {
          callback(null, '', '');
        }
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = await startAmaranApp(true);

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
      mockExec.mockImplementation((command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        if (command.includes('ps aux')) {
          callback(
            null,
            'amaran Desktop 12345 0.0  0.1  123456  1234 ??  10:30AM 0:00.01 /Applications/amaran Desktop.app/Contents/MacOS/amaran Desktop',
            ''
          );
        }
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = await handleAutostart(true);

      expect(result).toBe(true);
    });

    it('should attempt to start app when not running', async () => {
      mockExec.mockImplementation((command: string, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        if (command.includes('ps aux')) {
          callback(null, '', '');
        } else if (command.includes('open -a "amaran Desktop"')) {
          callback(null, '', '');
        }
      });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({}));

      const result = await handleAutostart(true);

      expect(result).toBe(true);
    });
  });
});
