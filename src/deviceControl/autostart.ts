import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../config.js';

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

function loadAutostartConfig(debug: boolean): AppConfig | null {
  try {
    return loadConfig();
  } catch (error) {
    if (debug) {
      const message = error instanceof Error ? error.message : String(error);
      logAutostart(`Ignoring invalid config during autostart: ${message}`, debug);
    }
    return null;
  }
}

/**
 * Check if the Amaran desktop app is running by looking for processes
 * that contain "amaran desktop" (case-insensitive)
 */
export async function isAmaranAppRunning(debug: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ps', ['aux'], (error, stdout) => {
      if (error) {
        if (debug) {
          logAutostart(`Failed to check if app is running: ${error.message}`, debug);
        }
        resolve(false);
        return;
      }

      const matchingProcesses = stdout
        .split(/\r?\n/)
        .filter((line) => /amaran desktop/i.test(line))
        .join('\n');
      const isRunning = matchingProcesses.length > 0;

      if (debug) {
        logAutostart(`App running check: ${isRunning ? 'FOUND' : 'NOT FOUND'}`, debug);
        if (isRunning) {
          console.log(chalk.gray(`[AUTOSTART] Found Amaran Desktop processes:\n${matchingProcesses}`));
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
  const config = loadAutostartConfig(debug);

  // Check if autostart is disabled in config
  if (config?.autoStartApp === false) {
    logAutostart('Autostart is disabled in configuration', debug);
    return false;
  }

  return new Promise((resolve) => {
    logAutostart('Attempting to start Amaran desktop app...', debug);

    // Try different methods to start the app on macOS
    const startMethods = [
      ['-a', 'amaran Desktop'],
      ['-a', 'amaran desktop'],
      ['-a', 'Amaran Desktop'],
      ['-a', 'AMARAN DESKTOP'],
      ['/Applications/amaran Desktop.app'],
      ['/Applications/Amaran Desktop.app'],
    ];

    let methodIndex = 0;

    const tryNextMethod = () => {
      if (methodIndex >= startMethods.length) {
        logAutostart('Failed to start app - tried all known methods', debug);

        if (debug) {
          console.log(chalk.yellow('[AUTOSTART] Could not find or start Amaran app. Tried:'));
          startMethods.forEach((method) => {
            console.log(chalk.gray(`  - open ${method.join(' ')}`));
          });
          console.log(
            chalk.yellow('Make sure the Amaran desktop app is installed in /Applications or available via "open -a"')
          );
        }

        resolve(false);
        return;
      }

      const method = startMethods[methodIndex];
      execFile('open', method, (error) => {
        if (error) {
          // Try the next method
          methodIndex++;
          tryNextMethod();
          return;
        }

        logAutostart(`Successfully started app using: open ${method.join(' ')}`, debug);

        if (debug) {
          console.log(chalk.green(`[AUTOSTART] Started Amaran app using: open ${method.join(' ')}`));
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
  const config = loadAutostartConfig(debug);

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
