import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

export function registerIntensity(program: Command, deps: CommandDeps) {
  const { createController, findDevice, asyncCommand } = deps;

  program
    .command('intensity <value> [device]')
    .description('Set light intensity (0-100). Omit device or use "all" to set all lights.')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(
      asyncCommand(async (intensityStr: string, deviceQuery: string | undefined, options: CommandOptions) => {
        const intensity = parseInt(intensityStr, 10);
        if (Number.isNaN(intensity) || intensity < 0 || intensity > 100) {
          console.error(chalk.red('Intensity must be a number between 0 and 100'));
          process.exit(1);
        }

        const controller = await createController(options.url, options.clientId, options.debug);

        // Convert 0-100 user input to 0-1000 API range
        const apiIntensity = intensity * 10;

        if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
          await controller.setIntensityForAllLights(apiIntensity, (success: boolean, message: string) => {
            if (!success) {
              console.error(chalk.red(`✗ Failed to set intensity: ${message}`));
            }
          });
          await controller.disconnect();
          return;
        }

        const device = findDevice(controller, deviceQuery);
        if (!device) {
          console.error(chalk.red(`Device "${deviceQuery}" not found`));
          process.exit(1);
        }

        if (!device.node_id) {
          console.error(chalk.red(`Device "${deviceQuery}" has no node_id`));
          process.exit(1);
        }

        controller.setIntensity(device.node_id, apiIntensity, (success: boolean, message: string) => {
          if (success) {
            const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
            console.log(chalk.green(`✓ ${displayName} intensity set to ${intensity}%`));
          } else {
            console.error(chalk.red(`✗ Failed to set intensity: ${message}`));
          }
          controller.disconnect();
        });
      })
    );
}

export default registerIntensity;
