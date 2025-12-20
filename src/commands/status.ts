import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types.js';

export function registerStatus(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('status <device>')
    .description('Get the current status of a light')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleStatus(deps)));
}

function handleStatus(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (deviceQuery: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    const device = findDevice(controller, deviceQuery);
    if (!device) {
      console.error(chalk.red(`Device "${deviceQuery}" not found`));
      process.exit(1);
    }

    if (!device.node_id) {
      console.error(chalk.red(`Device "${deviceQuery}" has no node_id`));
      process.exit(1);
    }

    const nodeId = device.node_id;

    controller.getLightSleepStatus(nodeId, (success: boolean, message: string, data?: unknown) => {
      if (success) {
        const nodeConfig = controller.getNode(nodeId);
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        console.log(chalk.blue(`Status for ${displayName}:`));
        console.log(`  State: ${(data as { sleep?: boolean })?.sleep ? chalk.red('Off') : chalk.green('On')}`);

        if (nodeConfig) {
          if (nodeConfig.intensity !== undefined) {
            console.log(`  Intensity: ${nodeConfig.intensity}%`);
          }
          if (nodeConfig.cct !== undefined) {
            console.log(`  Temperature: ${nodeConfig.cct}K`);
          }
          if (nodeConfig.hue !== undefined && nodeConfig.sat !== undefined) {
            console.log(`  HSI: H:${nodeConfig.hue} S:${nodeConfig.sat} I:${nodeConfig.intensity}`);
          }
        }
      } else {
        console.error(chalk.red(`✗ Failed to get status: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerStatus;
