#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import registerCommands from './commands';
import { discoverLocalWebSocket } from './discovery';
import LightController from './lightControl';
import type { Device } from './types';

const program = new Command();

// Configuration file path
const configPath = path.join(process.env.HOME || '', '.amaran-cli.json');

interface Config {
  wsUrl?: string;
  clientId?: string;
  debug?: boolean;
  latitude?: number;
  longitude?: number;
  // Auto-CCT bounds
  cctMin?: number; // Kelvin
  cctMax?: number; // Kelvin
  intensityMin?: number; // percent [0-100]
  intensityMax?: number; // percent [0-100]
  [key: string]: unknown;
}

// Load configuration
function loadConfig(): Config | null {
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

// Save configuration
function saveConfig(config: Config): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green('Configuration saved successfully'));
  } catch (error) {
    console.error(chalk.red('Error saving configuration:'), error);
  }
}

function saveWsUrl(url: string) {
  const current = loadConfig() || {};
  current.wsUrl = url;
  saveConfig(current);
}

// Create light controller with connection handling
async function createController(wsUrl?: string, clientId?: string, debug?: boolean): Promise<LightController> {
  const config = loadConfig();
  let url = wsUrl || config?.wsUrl;
  const id = clientId || config?.clientId || 'amaran-cli';
  const debugMode = debug !== undefined ? debug : config?.debug || false;

  const connectWithUrl = (candidateUrl: string): Promise<LightController> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 8000);

      const controller = new LightController(candidateUrl, id, undefined, debugMode);

      // Resolve once we have a device list back (works even if zero devices)
      controller.getDeviceList((success: boolean, message: string) => {
        clearTimeout(timeout);
        if (!success) {
          reject(new Error(message || 'Failed to fetch device list'));
          return;
        }
        if (debugMode) {
          console.log(chalk.green('✓ Connected (device list received)'));
        }
        resolve(controller);
      });
    });
  };

  // If no URL is known, try discovery first and persist
  if (!url) {
    const found = await discoverLocalWebSocket('127.0.0.1', debugMode);
    if (found) {
      url = found.url;
      if (debugMode) {
        console.log(chalk.green(`✓ Discovered WebSocket at ${url} (process: ${found.process})`));
      }
      saveWsUrl(url);
    } else {
      url = 'ws://localhost:60124';
      if (debugMode) {
        console.log(chalk.yellow(`⚠︎ Discovery failed, falling back to ${url}`));
      }
    }
  }

  // Try to connect; on failure, discover, persist, and retry once
  try {
    return await connectWithUrl(url);
  } catch (e) {
    if (debugMode) {
      console.log(chalk.yellow(`Initial connection to ${url} failed; attempting discovery...`));
    }
    const found = await discoverLocalWebSocket('127.0.0.1', debugMode);
    if (found) {
      if (debugMode) {
        console.log(chalk.green(`✓ Discovered fallback WebSocket at ${found.url}`));
      }
      saveWsUrl(found.url);
      return await connectWithUrl(found.url);
    }
    throw e;
  }
}

// Helper function to handle async commands
function asyncCommand<T extends unknown[]>(fn: (...args: T) => Promise<void>) {
  return (...args: T): Promise<void> => {
    return fn(...args).catch((error) => {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    });
  };
}

// Helper function to find device by name or ID
function findDevice(controller: LightController, deviceQuery: string): Device | null {
  const devices = controller.getDevices();

  // Try to find by exact ID first
  let device = devices.find((d: Device) => d.node_id === deviceQuery || d.id === deviceQuery);

  // If not found, try to find by name (case insensitive)
  if (!device) {
    const q = deviceQuery.toLowerCase();
    device = devices.find((d: Device) => {
      const nm = (d.device_name || d.name || '').toLowerCase();
      return nm.includes(q);
    });
  }

  return device || null;
}

// Main CLI setup
program.name('amaran-cli').description('Command line tool for controlling Aputure Amaran lights').version('1.0.1');

// Configuration command
program
  .command('config')
  .description('Configure WebSocket URL and other settings')
  .option('-u, --url <url>', 'WebSocket URL (default: ws://localhost:60124)')
  .option('-c, --client-id <id>', 'Client ID (default: amaran-cli)')
  .option('-d, --debug', 'Enable debug mode')
  .option('--lat <latitude>', 'Default latitude for auto-cct (overrides geoip)')
  .option('--lon <longitude>', 'Default longitude for auto-cct (overrides geoip)')
  .option('--cct-min <kelvin>', 'Minimum CCT for auto-cct in Kelvin (default: 2000)')
  .option('--cct-max <kelvin>', 'Maximum CCT for auto-cct in Kelvin (default: 6500)')
  .option('--intensity-min <percent>', 'Minimum intensity for auto-cct in percent (default: 5)')
  .option('--intensity-max <percent>', 'Maximum intensity for auto-cct in percent (default: 100)')
  .option('--show', 'Show current configuration')
  .action((options: Record<string, unknown>) => {
    if (options.show) {
      const config = loadConfig();
      console.log(chalk.blue('Current configuration:'));
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    const config = loadConfig() || {};
    if (options.url) config.wsUrl = options.url as string;
    if (options.clientId) config.clientId = options.clientId as string;
    if (options.debug !== undefined) config.debug = options.debug as boolean;
    if (options.lat !== undefined) {
      const lat = parseFloat(options.lat as string);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        console.error(chalk.red('Latitude must be between -90 and 90'));
        process.exit(1);
      }
      config.latitude = lat;
    }
    if (options.lon !== undefined) {
      const lon = parseFloat(options.lon as string);
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        console.error(chalk.red('Longitude must be between -180 and 180'));
        process.exit(1);
      }
      config.longitude = lon;
    }

    // Bounds validation helpers
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    if (options.cctMin !== undefined) {
      const k = parseInt(options.cctMin as string, 10);
      if (Number.isNaN(k)) {
        console.error(chalk.red('cct-min must be a number (Kelvin)'));
        process.exit(1);
      }
      config.cctMin = clamp(k, 1000, 20000);
    }
    if (options.cctMax !== undefined) {
      const k = parseInt(options.cctMax as string, 10);
      if (Number.isNaN(k)) {
        console.error(chalk.red('cct-max must be a number (Kelvin)'));
        process.exit(1);
      }
      config.cctMax = clamp(k, 1000, 20000);
    }
    if (options.intensityMin !== undefined) {
      const p = parseFloat(options.intensityMin as string);
      if (Number.isNaN(p)) {
        console.error(chalk.red('intensity-min must be a number (percent)'));
        process.exit(1);
      }
      config.intensityMin = clamp(p, 0, 100);
    }
    if (options.intensityMax !== undefined) {
      const p = parseFloat(options.intensityMax as string);
      if (Number.isNaN(p)) {
        console.error(chalk.red('intensity-max must be a number (percent)'));
        process.exit(1);
      }
      config.intensityMax = clamp(p, 0, 100);
    }

    // Ensure logical ordering if both sides provided
    if (config.cctMin !== undefined && config.cctMax !== undefined && config.cctMin > config.cctMax) {
      console.error(chalk.red('cct-min must be <= cct-max'));
      process.exit(1);
    }
    if (
      config.intensityMin !== undefined &&
      config.intensityMax !== undefined &&
      config.intensityMin > config.intensityMax
    ) {
      console.error(chalk.red('intensity-min must be <= intensity-max'));
      process.exit(1);
    }

    saveConfig(config);
  });

// Register all commands
registerCommands(program, { createController, findDevice, asyncCommand, saveWsUrl, loadConfig });

// If this file is run directly, parse the arguments
if (require.main === module) {
  program.parse();
}

export { program, createController, findDevice, asyncCommand };
