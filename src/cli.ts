#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import registerCommands from './commands.js';
import { loadConfig, saveConfig } from './config.js';
import { handleAutostart } from './deviceControl/autostart.js';
import BleHttpController from './deviceControl/bleHttpControl.js';
import { discoverLocalWebSocket } from './deviceControl/discovery.js';
import LightController from './deviceControl/lightControl.js';
import { enableGlobalTimestamps } from './deviceControl/logging.js';
import type { Config, Device, LightBackend } from './deviceControl/types.js';

// Enable global timestamps only if running in service mode
if (process.argv.includes('--service-mode')) {
  enableGlobalTimestamps();
  console.error(chalk.blue('Circadian lighting service started'));
}

const program = new Command();

// Configure help output
import packageJson from '../package.json' with { type: 'json' };

const { version } = packageJson;

function getRuntimeLabel(): string {
  return fileURLToPath(import.meta.url).endsWith(path.join('src', 'cli.ts')) ? ' (dev)' : '';
}

const HELP_DETAILS: Record<string, { notes?: string[]; examples: string[] }> = {
  '': {
    notes: [
      'Direct BLE is the default backend. Use --backend desktop for Amaran Desktop; --backend websocket remains a compatibility alias.',
    ],
    examples: [
      'amaran-cli status',
      'amaran-cli cct 5000 all --intensity 80',
      'amaran-cli color "#ff6400" back --intensity 20',
      'amaran-cli ble dashboard --open',
      'amaran-cli list --backend desktop',
    ],
  },
  ble: {
    notes: [
      'Direct BLE commands use the loopback daemon. Hardware writes require matching readback; library imports never apply lighting.',
    ],
    examples: [
      'amaran-cli ble health',
      'amaran-cli ble dashboard --open',
      'amaran-cli ble import-desktop "/path/to/amaran.db"',
      'amaran-cli ble batch brightness --targets all --args \'{"value":50}\'',
    ],
  },
  desktop: {
    notes: [
      'These commands explicitly require Amaran Desktop. Ordinary light control uses direct BLE by default.',
      'Firmware availability checks are not exposed because the Desktop protocol does not provide a reliable check through this CLI.',
    ],
    examples: [
      'amaran-cli desktop discover',
      'amaran-cli desktop firmware update desk',
      'amaran-cli desktop firmware update desk --url ws://localhost:60124',
    ],
  },
  'desktop discover': {
    notes: ['Finds Amaran Desktop with lsof and saves its WebSocket URL for explicit Desktop-backend use.'],
    examples: ['amaran-cli desktop discover', 'amaran-cli desktop discover --debug'],
  },
  'desktop firmware update': {
    notes: [
      'This always uses the Amaran Desktop backend; the direct BLE daemon intentionally does not implement OTA updates.',
    ],
    examples: ['amaran-cli desktop firmware update desk'],
  },
  'ble dashboard': {
    notes: [
      'The dashboard is loopback-only and uses the same verified API as the CLI.',
      'Estimated lux uses maxLuxByModel for the fixture model, then falls back to maxLux.',
    ],
    examples: ['amaran-cli ble dashboard', 'amaran-cli ble dashboard --open'],
  },
  'ble import-desktop': {
    notes: [
      'Preview is the default and never changes lights or the local library.',
      'Effect presets, quickshots, and explicit workspace groups are validated before --apply. Use --replace only to update a previous import.',
      'Supported effects: Paparazzi, Lightning, TV, Fire, Strobe, Explosion, Faulty Bulb, Pulsing, Cop Car, Party Lights, and Fireworks.',
    ],
    examples: [
      'amaran-cli ble import-desktop "/path/to/amaran.db"',
      'amaran-cli ble import-desktop "/path/to/amaran.db" --apply',
      'amaran-cli ble import-desktop "/path/to/amaran.db" --apply --replace',
    ],
  },
  config: {
    notes: [
      '--max-lux accepts a positive number or a Kelvin map such as 2700:8000,5600:10000.',
      'Per-model dashboard curves use maxLuxByModel in config.json with 200x, 200x-s, or 150c keys.',
    ],
    examples: [
      'amaran-cli config --backend ble --ble-url http://localhost:2708',
      'amaran-cli config --max-lux "2700:8000,5600:10000"',
      'amaran-cli config --show',
    ],
  },
  effect: {
    notes: [
      'Effect frequency and animation speed are separate fields. animation-speed is supported by Lightning, Faulty Bulb, and Pulsing.',
      'Trigger requests are sent once because fixtures do not acknowledge the physical transient event.',
    ],
    examples: [
      'amaran-cli effect list',
      'amaran-cli effect custom back pulsing --params \'{"brightness":20,"frequency":5,"speed":4,"hue":120,"saturation":80}\'',
      'amaran-cli effect animation-speed back 4',
      'amaran-cli effect stop all',
    ],
  },
  preset: {
    notes: [
      'Presets store one fixture state but may be retargeted at recall; the destination fixture is validated before any write.',
      'Desktop effect presets imported with ble import-desktop appear in this library.',
    ],
    examples: [
      'amaran-cli preset list',
      'amaran-cli preset show "Desktop: Effect 01"',
      'amaran-cli preset recall back "Desktop: Effect 01"',
    ],
  },
};

program
  .name('amaran-cli')
  .description(
    'Control Aputure Amaran lights through Amaran Desktop or the verified local Bluetooth Mesh daemon, with circadian automation.'
  )
  .version(version, '-v, --version', 'output the current version')
  .option('--service-mode', 'Internal flag for being run from background service')
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
        `${chalk.blue(`Amaran Light Control CLI - v${version}${getRuntimeLabel()}`)}`,
        '',
        `${chalk.blue('Usage:')} ${displayName}${commandName ? ` ${commandName}` : ''} [options]${isRoot ? ' [command]' : ''}`,
        '',
      ];

      // Add command description if available
      if (cmd.description()) {
        sections.push(`${chalk.blue('Description:')} ${cmd.description()}`, '');
      }

      // Add command usage pattern if available
      if (cmd.usage() && cmd.usage() !== '[options] [command]') {
        const usage = cmd.usage().replace(/^\s*/, '');
        sections.push(`${chalk.blue('Usage:')} ${cmd.name()} ${chalk.blue(usage)}`, '');
      }

      // Add options
      const options = helper.visibleOptions(cmd);
      if (options.length > 0) {
        sections.push(chalk.blue('Options:'));

        // Calculate the maximum length of the raw flags (visible text)
        const maxOptionWidth = Math.max(
          ...options.map((o) => o.flags.length),
          20 // Minimum width
        );

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

            // Calculate padding needed based on the original flags length
            const padding = ' '.repeat(maxOptionWidth - option.flags.length + 2);

            return `  ${formattedFlags}${padding}${option.description}`;
          })
        );
        sections.push('');
      }

      // Add commands
      const commands = helper.visibleCommands(cmd);
      if (commands.length > 0) {
        sections.push(chalk.blue('Commands:'));

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

      const details = HELP_DETAILS[commandName];
      if (details?.notes?.length) {
        sections.push(chalk.blue('Notes:'), ...details.notes.map((note) => `  ${note}`), '');
      }
      if (details?.examples.length) {
        sections.push(chalk.blue('Examples:'), ...details.examples.map((example) => `  $ ${example}`), '');
      }

      sections.push(`Run ${chalk.blue('amaran-cli <command> --help')} for more information about a command.`);

      return sections.join('\n');
    },
  })
  .showHelpAfterError('(add --help for additional information)');

function saveCliConfig(config: Config, changes?: string[]): void {
  try {
    saveConfig(config);

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
    throw error;
  }
}

function saveWsUrl(url: string) {
  const current = loadConfig() || {};
  current.wsUrl = url;
  saveCliConfig(current, [`WebSocket URL: ${url}`]);
}

function parseBackend(value: unknown): LightBackend | undefined {
  if (value === undefined) return undefined;
  if (value === 'ble' || value === 'desktop' || value === 'websocket') return value;
  throw new Error('Backend must be "ble" or "desktop" ("websocket" remains an alias)');
}

// Create light controller with connection handling
async function createController(
  wsUrl?: string,
  clientId?: string,
  debug?: boolean,
  backend?: LightBackend
): Promise<LightController | BleHttpController> {
  const config = loadConfig();
  const selectedBackend = backend || config?.backend || 'ble';
  if (selectedBackend === 'ble') {
    const url = wsUrl || config?.bleUrl || 'http://localhost:2708';
    if (debug) {
      console.log(chalk.blue(`Connecting to BLE HTTP backend at ${url}`));
    }
    return BleHttpController.connect(url, config?.bleApiKey);
  }

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
          console.error(chalk.red(`WebSocket connection failed to ${addressPort}`));
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

// (The 'config' command is registered centrally in src/commands/config.ts via registerCommands.)

// Register all commands
registerCommands(program, {
  createController: (wsUrl, clientId, debug, backend) =>
    createController(wsUrl, clientId, debug, parseBackend(backend)),
  findDevice,
  asyncCommand,
  saveWsUrl,
  loadConfig,
  saveConfig: saveCliConfig,
});

// Add custom help command that preserves the formatting
program.helpCommand('help [command]', 'Display help for a specific command');

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;

  try {
    return realpathSync(entrypoint) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// If this file is run directly, parse the arguments. Resolve symlinks so npm
// global bins like /opt/homebrew/bin/amaran-cli still execute the CLI.
if (isDirectRun()) {
  program.parse(process.argv);
}

export { program, createController, findDevice, asyncCommand, registerCommands };
