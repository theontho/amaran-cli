import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types.js';

export function registerHsi(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('hsi <hue> <saturation> <intensity> [device]')
    .description(
      'Set HSI color (hue: 0-360, saturation: 0-100, intensity: 0-100). Omit device or use "all" to set all lights.'
    )
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleHsi(deps)));
}

function handleHsi(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (
    hueStr: string,
    satStr: string,
    intStr: string,
    deviceQuery: string | undefined,
    options: CommandOptions
  ) => {
    const hue = parseInt(hueStr, 10);
    const saturation = parseInt(satStr, 10);
    const intensity = parseInt(intStr, 10);

    if (Number.isNaN(hue) || hue < 0 || hue > 360) {
      console.error(chalk.red('Hue must be between 0 and 360'));
      process.exit(1);
    }
    if (Number.isNaN(saturation) || saturation < 0 || saturation > 100) {
      console.error(chalk.red('Saturation must be between 0 and 100'));
      process.exit(1);
    }
    if (Number.isNaN(intensity) || intensity < 0 || intensity > 100) {
      console.error(chalk.red('Intensity must be between 0 and 100'));
      process.exit(1);
    }

    const apiIntensity = intensity * 10;

    const controller = await createController(options.url, options.clientId, options.debug);

    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await controller.setHSIForAllLights(
        hue,
        saturation,
        apiIntensity,
        undefined,
        undefined,
        (success: boolean, message: string) => {
          if (!success) {
            console.error(chalk.red(`✗ Failed to set HSI color: ${message}`));
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

    controller.setHSI(
      device.node_id,
      hue,
      saturation,
      apiIntensity,
      undefined,
      undefined,
      (success: boolean, message: string) => {
        if (success) {
          const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
          console.log(chalk.green(`✓ ${displayName} color set to H:${hue} S:${saturation} I:${intensity}`));
        } else {
          console.error(chalk.red(`✗ Failed to set HSI color: ${message}`));
        }
        controller.disconnect();
      }
    );
  };
}

export default registerHsi;
