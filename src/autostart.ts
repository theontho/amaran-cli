import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

export interface AppConfig {
  wsUrl?: string;
  clientId?: string;
  debug?: boolean;
  latitude?: number;
  longitude?: number;
  cctMin?: number;
  cctMax?: number;
  intensityMin?: number;
  intensityMax?: number;
  autoStartApp?: boolean; // New option to control autostart behavior
  [key: string]: unknown;
}

const configPath = path.join(process.env.HOME || '', '.amaran-cli.json');

function loadConfig(): AppConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    }
    return null;
  } catch (_error) {
    console.warn(chalk.yellow('Warning: Could not load config file'));
    return null;
  }
}

function logAutostart(message: string, debug: boolean = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [AUTOSTART] ${message}`;

  if (debug) {
    console.log(chalk.gray(logMessage));
  }

  // Also log to a file for persistence
  try {
    const logPath = path.join(process.env.HOME || '', '.amaran-cli-autostart.log');
    fs.appendFileSync(logPath, `${logMessage}\n`);
  } catch (_error) {
    // Ignore logging errors
  }
}

/**
 * Check if the Amaran desktop app is running by looking for processes
 * that contain "amaran desktop" (case-insensitive)
 */
export async function isAmaranAppRunning(debug: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    exec('ps aux | grep -i "amaran desktop" | grep -v grep', (error, stdout) => {
      if (error) {
        if (debug) {
          logAutostart(`Failed to check if app is running: ${error.message}`, debug);
        }
        resolve(false);
        return;
      }

      const isRunning = stdout.trim().length > 0;

      if (debug) {
        logAutostart(`App running check: ${isRunning ? 'FOUND' : 'NOT FOUND'}`, debug);
        if (isRunning) {
          console.log(chalk.gray(`[AUTOSTART] Found Amaran Desktop processes:\n${stdout}`));
        }
      }

      resolve(isRunning);
    });
  });
}

/**
 * Attempt to start the Amaran desktop app
 * This implementation tries common locations and methods for macOS
 */
export async function startAmaranApp(debug: boolean = false): Promise<boolean> {
  const config = loadConfig();

  // Check if autostart is disabled in config
  if (config?.autoStartApp === false) {
    logAutostart('Autostart is disabled in configuration', debug);
    return false;
  }

  return new Promise((resolve) => {
    logAutostart('Attempting to start Amaran desktop app...', debug);

    // Try different methods to start the app on macOS
    const startMethods = [
      'open -a "amaran Desktop" 2>/dev/null',
      'open -a "amaran desktop" 2>/dev/null',
      'open -a "Amaran Desktop" 2>/dev/null',
      'open -a "AMARAN DESKTOP" 2>/dev/null',
      'open "/Applications/amaran Desktop.app" 2>/dev/null',
      'open "/Applications/Amaran Desktop.app" 2>/dev/null',
    ];

    let methodIndex = 0;

    const tryNextMethod = () => {
      if (methodIndex >= startMethods.length) {
        logAutostart('Failed to start app - tried all known methods', debug);

        if (debug) {
          console.log(chalk.yellow('[AUTOSTART] Could not find or start Amaran app. Tried:'));
          startMethods.forEach((method) => {
            console.log(chalk.gray(`  - ${method}`));
          });
          console.log(
            chalk.yellow('Make sure the Amaran desktop app is installed in /Applications or available via "open -a"')
          );
        }

        resolve(false);
        return;
      }

      const method = startMethods[methodIndex];
      exec(method, (error) => {
        if (error) {
          // Try the next method
          methodIndex++;
          tryNextMethod();
          return;
        }

        logAutostart(`Successfully started app using: ${method}`, debug);

        if (debug) {
          console.log(chalk.green(`[AUTOSTART] Started Amaran app using: ${method}`));
        }

        // Give the app a moment to start up
        setTimeout(() => {
          resolve(true);
        }, 2000);
      });
    };

    tryNextMethod();
  });
}

/**
 * Main function to handle autostart logic
 * Checks if app is running, and if not, attempts to start it (unless disabled)
 */
export async function handleAutostart(debug: boolean = false): Promise<boolean> {
  const config = loadConfig();

  // Log the autostart setting
  const autoStartEnabled = config?.autoStartApp !== false; // Default to true
  logAutostart(`Autostart setting: ${autoStartEnabled ? 'ENABLED' : 'DISABLED'}`, debug);

  if (!autoStartEnabled) {
    logAutostart('Autostart is blocked by configuration setting', debug);
    if (debug) {
      console.log(
        chalk.yellow('[AUTOSTART] Autostart is disabled. Use "amaran config --auto-start-app true" to enable.')
      );
    }
    return false;
  }

  const isRunning = await isAmaranAppRunning(debug);
  if (isRunning) {
    logAutostart('App is already running - no action needed', debug);
    return true;
  }

  logAutostart('App is not running - attempting to start', debug);
  const started = await startAmaranApp(debug);

  if (started) {
    logAutostart('Successfully started Amaran desktop app', debug);
    if (debug) {
      console.log(chalk.green('[AUTOSTART] Amaran desktop app started successfully'));
    }
  } else {
    logAutostart('Failed to start Amaran desktop app', debug);
    if (debug) {
      console.log(chalk.red('[AUTOSTART] Failed to start Amaran desktop app'));
    }
  }

  return started;
}
