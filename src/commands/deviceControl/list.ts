import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { getLightDevices } from '../cmdUtils.js';

export function registerList(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('list')
    .name('list')
    .usage('[options]')
    .alias('ls')
    .description('List all available lights')
    .option('-b, --backend <backend>', 'Light backend: websocket or ble')
    .option('-u, --url <url>', 'Backend URL (WebSocket or BLE HTTP)')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleList(deps)));
}

function handleList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    try {
      const devices = getLightDevices(controller.getDevices());

      if (devices.length === 0) {
        console.log(chalk.yellow('No light devices found'));
        return;
      }

      console.log(chalk.blue('Available lights:'));
      devices.forEach((device, index: number) => {
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        console.log(`${index + 1}. ${chalk.green(displayName)} (${chalk.gray(device.node_id || device.id || '?')})`);
        if (device.device_type) {
          console.log(`   Type: ${device.device_type}`);
        }
      });
    } finally {
      await controller.disconnect();
    }
  };
}

export default registerList;
