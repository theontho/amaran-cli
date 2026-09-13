import chalk from 'chalk';
import type { Command } from 'commander';
import { discoverLocalWebSocket } from '../../deviceControl/discovery.js';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { runDeviceAction } from '../cmdUtils.js';

export function registerDesktop(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const desktop = program.command('desktop').description('Amaran Desktop compatibility and vendor lifecycle commands');

  registerDesktopDiscovery(desktop, deps);

  const firmware = desktop.command('firmware').description('Amaran Desktop firmware management');
  firmware
    .command('update <device>')
    .description('Start a vendor firmware update through Amaran Desktop')
    .option('-u, --url <url>', 'Amaran Desktop WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleFirmwareUpdate(deps)));
}

function registerDesktopDiscovery(parent: Command, deps: CommandDeps) {
  parent
    .command('discover')
    .description('Discover and save the local Amaran Desktop WebSocket endpoint')
    .option('-d, --debug', 'Enable debug output')
    .action(deps.asyncCommand(handleDiscover(deps)));
}

export function registerDiscover(program: Command, deps: CommandDeps) {
  registerDesktopDiscovery(program, deps);
}

function handleDiscover(deps: CommandDeps) {
  const { saveWsUrl } = deps;
  return async (options: CommandOptions) => {
    const res = await discoverLocalWebSocket('127.0.0.1', !!options.debug);
    if (res) {
      console.log(chalk.green(`Found WebSocket: ${res.url} (process: ${res.process})`));
      if (saveWsUrl) {
        saveWsUrl(res.url);
        console.log(chalk.green('Saved to configuration.'));
      }
    } else {
      console.log(chalk.yellow('No local Amaran Desktop WebSocket found via lsof'));
    }
  };
}

function handleFirmwareUpdate(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options: { ...options, backend: 'desktop' },
        deviceQuery,
        actionName: 'update firmware through Amaran Desktop',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.updateFirmware(device.node_id as string, (success, message, data) => {
            if (success) {
              console.log(chalk.green('Firmware update started through Amaran Desktop:'), data);
            } else {
              console.error(chalk.red(`Error starting firmware update through Amaran Desktop: ${message}`));
            }
            resolve();
          });
        });
      },
      () => Promise.resolve()
    );
  };
}

export default registerDesktop;
