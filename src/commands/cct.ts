import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

export function registerCct(program: Command, deps: CommandDeps) {
  const { createController, findDevice, asyncCommand } = deps;

  program
    .command('cct <temperature> [device]')
    .description(
      'Set color temperature in Kelvin (2000-6500). Omit device or use "all" to set all lights.'
    )
    .option('-i, --intensity <value>', 'Also set intensity (0-100)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(
      asyncCommand(
        async (tempStr: string, deviceQuery: string | undefined, options: CommandOptions) => {
          const temperature = parseInt(tempStr, 10);
          if (Number.isNaN(temperature) || temperature < 2000 || temperature > 6500) {
            console.error(chalk.red('Temperature must be between 2000K and 6500K'));
            process.exit(1);
          }

          let intensity: number | undefined;
          if (options.intensity) {
            intensity = parseInt(options.intensity, 10);
            if (Number.isNaN(intensity) || intensity < 0 || intensity > 100) {
              console.error(chalk.red('Intensity must be a number between 0 and 100'));
              process.exit(1);
            }
            intensity = intensity * 10;
          }

          const controller = await createController(options.url, options.clientId, options.debug);

          if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
            await controller.setCCTAndIntensityForAllLights(
              temperature,
              intensity,
              (success: boolean, message: string) => {
                if (!success) {
                  console.error(chalk.red(`✗ Failed to set temperature: ${message}`));
                }
              }
            );
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

          controller.setCCT(
            device.node_id,
            temperature,
            intensity,
            (success: boolean, message: string) => {
              if (success) {
                const displayName =
                  device.device_name || device.name || device.id || device.node_id || 'Unknown';
                let msg = `✓ ${displayName} temperature set to ${temperature}K`;
                if (intensity !== undefined) {
                  msg += ` at ${intensity / 10}% intensity`;
                }
                console.log(chalk.green(msg));
              } else {
                console.error(chalk.red(`✗ Failed to set temperature: ${message}`));
              }
              controller.disconnect();
            }
          );
        }
      )
    );
}

export default registerCct;
