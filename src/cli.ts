#!/usr/bin/env node

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { handleAutostart } from './autostart';
import registerCommands from './commands';
import { discoverLocalWebSocket } from './discovery';
import LightController from './lightControl';
import type { Device } from './types';

const program = new Command();

// Configure help output
import { version } from '../package.json';

program
  .name('amaran-cli')
  .description('Command line tool for controlling Aputure Amaran lights via WebSocket')
  .version(version, '-v, --version', 'output the current version')
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    showGlobalOptions: true,
    formatHelp: (cmd, helper) => {
      const isRoot = cmd.name() === 'amaran-cli';
      const commandPath = isRoot ? [] : [cmd.name()];
      let current = cmd.parent;
      
      // Build the full command path
      while (current && current.name() !== 'amaran-cli') {
        commandPath.unshift(current.name());
        current = current.parent;
      }
      
      const commandName = commandPath.join(' ');
      const displayName = 'amaran-cli';

      const sections = [
        `${chalk.blue.bold('Amaran Light Control CLI')}`,
        '',
        `${chalk.bold('Usage:')} ${displayName}${commandName ? ` ${commandName}` : ''} [options]${isRoot ? ' [command]' : ''}`,
        '',
      ];

      // Add command description if available
      if (cmd.description()) {
        sections.push(`${chalk.bold('Description:')} ${cmd.description()}`, '');
      }

      // Add command usage pattern if available
      if (cmd.usage() && cmd.usage() !== '[options] [command]') {
        const usage = cmd.usage().replace(/^\s*/, '');
        sections.push(`${chalk.bold('Usage:')} ${cmd.name()} ${chalk.blue(usage)}`, '');
      }

      // Add options
      const options = helper.visibleOptions(cmd);
      if (options.length > 0) {
        sections.push(chalk.bold('Options:'));
        sections.push(
          ...options.map((option) => {
            // Split the flags and replace parameter placeholders with bright white
            const formattedFlags = option.flags
              .split(/\s+/)
              .map((part) => {
                // Match parameter placeholders like <curve> or <date>
                const match = part.match(/^(--?[\w-]+)(?:\s+(<[^>]+>))?/);
                if (!match) return part;

                const [_, flag, param] = match;
                // Use blue for parameters and long options for better visibility in light mode
                const isShortFlag = flag.startsWith('-') && !flag.startsWith('--');
                const flagColor = isShortFlag ? chalk.cyan : chalk.blue;
                return param ? `${flagColor(flag)} ${chalk.blue(param)}` : flagColor(flag);
              })
              .join(' ');

            return `  ${formattedFlags.padEnd(40)} ${option.description}`;
          })
        );
        sections.push('');
      }

      // Add commands
      const commands = helper.visibleCommands(cmd);
      if (commands.length > 0) {
        sections.push(chalk.bold('Commands:'));

        // Get the max command + usage length for alignment
        const maxCommandWidth = Math.max(
          ...commands.map((c) => {
            const usage = c.usage() || '';
            return c.name().length + (usage ? usage.length + 1 : 0);
          }),
          25 // Minimum width
        );

        sections.push(
          ...commands.map((cmd) => {
            const name = cmd.name();
            const usage = cmd.usage() || '';
            const desc = cmd.description() || '';
            const _commandPart = usage ? `${name} ${chalk.blue(usage)}` : name;
            return `  ${chalk.green(name)} ${chalk.blue(usage || '').padEnd(maxCommandWidth - name.length - 1)}  ${desc}`;
          })
        );
        sections.push('');
      }

      // Add examples for the root command
      if (cmd.name() === 'amaran-cli') {
        sections.push(
          chalk.bold('Examples:'),
          '  $ amaran-cli power on --all        # Turn on all connected lights',
          '  $ amaran-cli cct 5000 --intensity 80  # Set color temperature to 5000K at 80%',
          '  $ amaran-cli color 255 100 50     # Set RGB color (R:255 G:100 B:50)',
          ''
        );
      }

      sections.push(`Run ${chalk.blue('amaran-cli <command> --help')} for more information about a command.`);

      return sections.join('\n');
    },
  })
  .showHelpAfterError('(add --help for additional information)');

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
  // Autostart behavior
  autoStartApp?: boolean; // Whether to automatically start the Amaran desktop app on connection failure
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
function saveConfig(config: Config, changes?: string[]): void {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    if (changes && changes.length > 0) {
      console.log(chalk.green('Configuration saved successfully:'));
      changes.forEach((change) => {
        console.log(chalk.green(`  • ${change}`));
      });
    } else {
      console.log(chalk.green('Configuration saved successfully'));
    }
  } catch (error) {
    console.error(chalk.red('Error saving configuration:'), error);
  }
}

function saveWsUrl(url: string) {
  const current = loadConfig() || {};
  current.wsUrl = url;
  saveConfig(current, [`WebSocket URL: ${url}`]);
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

      let hasResolved = false;
      let hasRejected = false;

      const controller = new LightController(candidateUrl, id, undefined, debugMode);

      // Set up error handling on the WebSocket to catch connection errors
      const ws = controller.getWebSocket();
      ws.on('error', (error: Error) => {
        if (debugMode) {
          console.error('WebSocket error:', error);
        } else {
          // Extract address and port from the error message for cleaner output
          const addressMatch = error.message.match(/(\S+:\d+)/);
          const addressPort = addressMatch ? addressMatch[1] : candidateUrl;
          console.error(chalk.red(`WebSocket connection failed to ${chalk.bold(addressPort)}`));
        }
        if (!hasResolved && !hasRejected) {
          hasRejected = true;
          clearTimeout(timeout);
          reject(new Error(`WebSocket connection failed: ${error.message}`));
        }
      });

      // Resolve once we have a device list back (works even if zero devices)
      controller.getDeviceList((success: boolean, message: string) => {
        if (hasRejected) return; // Don't resolve if we already rejected due to error

        clearTimeout(timeout);
        if (!success) {
          if (!hasRejected) {
            hasRejected = true;
            reject(new Error(message || 'Failed to fetch device list'));
          }
          return;
        }
        if (!hasResolved) {
          hasResolved = true;
          if (debugMode) {
            console.log(chalk.green('✓ Connected (device list received)'));
          }
          resolve(controller);
        }
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

  // Try to connect; on failure, attempt autostart, discover, persist, and retry once
  try {
    return await connectWithUrl(url);
  } catch (e) {
    const config = loadConfig();
    const autoStartEnabled = config?.autoStartApp !== false; // Default to true

    if (autoStartEnabled) {
      console.log(chalk.blue('🚀 Amaran desktop app not running, starting...'));
    }

    if (debugMode) {
      console.log(chalk.yellow(`Initial connection to ${url} failed; attempting autostart and discovery...`));
    }

    // Attempt to start the Amaran desktop app
    const autostartSuccess = await handleAutostart(debugMode);

    if (autostartSuccess) {
      // Give the app a moment to fully start up and begin listening
      if (debugMode) {
        console.log(chalk.blue('Waiting for app to initialize...'));
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Try discovery again (in case the app started on a different port)
    const found = await discoverLocalWebSocket('127.0.0.1', debugMode);
    if (found) {
      if (debugMode) {
        console.log(chalk.green(`✓ Discovered fallback WebSocket at ${found.url}`));
      }
      saveWsUrl(found.url);
      return await connectWithUrl(found.url);
    }

    // Provide appropriate error message based on what happened
    if (!autoStartEnabled) {
      console.log(chalk.yellow('Amaran desktop app is not running and autostart is disabled.'));
      console.log(chalk.yellow('Enable autostart with: amaran config --auto-start-app true'));
    } else if (!autostartSuccess) {
      console.log(chalk.yellow('Could not start Amaran desktop app. Please ensure it is installed and try again.'));
    } else {
      console.log(chalk.yellow('Amaran desktop app started but connection still failed. Please try again.'));
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

// Configuration command
program
  .command('config')
  .description('Configure WebSocket URL and other settings')
  .option('-u, --url <url>', 'WebSocket URL (default: ws://localhost:60124)')
  .option('-c, --client-id <id>', 'Client ID (default: amaran-cli)')
  .option('-d, --debug <boolean>', 'Enable debug mode')
  .option('--lat <latitude>', 'Default latitude for auto-cct (overrides geoip)')
  .option('--lon <longitude>', 'Default longitude for auto-cct (overrides geoip)')
  .option('--cct-min <kelvin>', 'Minimum CCT for auto-cct in Kelvin (default: 2000)')
  .option('--cct-max <kelvin>', 'Maximum CCT for auto-cct in Kelvin (default: 6500)')
  .option('--intensity-min <percent>', 'Minimum intensity for auto-cct in percent (default: 5)')
  .option('--intensity-max <percent>', 'Maximum intensity for auto-cct in percent (default: 100)')
  .option('--auto-start-app <boolean>', 'Automatically start Amaran desktop app on connection failure (default: true)')
  .option('--show', 'Show current configuration')
  .action((options: Record<string, unknown>) => {
    if (options.show) {
      const config = loadConfig();
      console.log(chalk.blue('Current configuration:'));
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    const config = loadConfig() || {};
    const changes: string[] = [];

    if (options.url) {
      config.wsUrl = options.url as string;
      changes.push(`WebSocket URL: ${options.url}`);
    }
    if (options.clientId) {
      config.clientId = options.clientId as string;
      changes.push(`Client ID: ${options.clientId}`);
    }
    if (options.debug !== undefined) {
      const value = options.debug as string;
      if (typeof value === 'boolean') {
        config.debug = value;
      } else {
        const lowerValue = value.toLowerCase().trim();
        if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
          config.debug = true;
        } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
          config.debug = false;
        } else {
          console.error(chalk.red('debug must be true or false'));
          process.exit(1);
        }
      }
      changes.push(`Debug mode: ${config.debug ? 'enabled' : 'disabled'}`);
    }
    if (options.lat !== undefined) {
      const lat = parseFloat(options.lat as string);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        console.error(chalk.red('Latitude must be between -90 and 90'));
        process.exit(1);
      }
      config.latitude = lat;
      changes.push(`Latitude: ${lat}`);
    }
    if (options.lon !== undefined) {
      const lon = parseFloat(options.lon as string);
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        console.error(chalk.red('Longitude must be between -180 and 180'));
        process.exit(1);
      }
      config.longitude = lon;
      changes.push(`Longitude: ${lon}`);
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
      changes.push(`CCT minimum: ${config.cctMin}K`);
    }
    if (options.cctMax !== undefined) {
      const k = parseInt(options.cctMax as string, 10);
      if (Number.isNaN(k)) {
        console.error(chalk.red('cct-max must be a number (Kelvin)'));
        process.exit(1);
      }
      config.cctMax = clamp(k, 1000, 20000);
      changes.push(`CCT maximum: ${config.cctMax}K`);
    }
    if (options.intensityMin !== undefined) {
      const p = parseFloat(options.intensityMin as string);
      if (Number.isNaN(p)) {
        console.error(chalk.red('intensity-min must be a number (percent)'));
        process.exit(1);
      }
      config.intensityMin = clamp(p, 0, 100);
      changes.push(`Intensity minimum: ${config.intensityMin}%`);
    }
    if (options.intensityMax !== undefined) {
      const p = parseFloat(options.intensityMax as string);
      if (Number.isNaN(p)) {
        console.error(chalk.red('intensity-max must be a number (percent)'));
        process.exit(1);
      }
      config.intensityMax = clamp(p, 0, 100);
      changes.push(`Intensity maximum: ${config.intensityMax}%`);
    }

    // Handle auto-start-app option
    if (options.autoStartApp !== undefined) {
      const value = options.autoStartApp as string;
      if (typeof value === 'boolean') {
        config.autoStartApp = value;
      } else {
        const lowerValue = value.toLowerCase().trim();
        if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
          config.autoStartApp = true;
        } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
          config.autoStartApp = false;
        } else {
          console.error(chalk.red('auto-start-app must be true or false'));
          process.exit(1);
        }
      }
      changes.push(`Auto-start app: ${config.autoStartApp ? 'enabled' : 'disabled'}`);
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

    saveConfig(config, changes);
  });

// Register all commands
registerCommands(program, { createController, findDevice, asyncCommand, saveWsUrl, loadConfig });

// Add custom help command that preserves the formatting
program.addHelpCommand('help [command]', 'Display help for a specific command');

// If this file is run directly, parse the arguments
if (require.main === module) {
  program.parse();
}

export { program, createController, findDevice, asyncCommand };
