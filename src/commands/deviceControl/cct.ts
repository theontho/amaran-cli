import chalk from 'chalk';
import type { Command } from 'commander';
import { VALIDATION_RANGES } from '../../deviceControl/constants.js';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';

export function registerCct(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('cct <temperature> [device]')
    .usage('<temperature> [device] [options]')
    .description(
      `Set color temperature in Kelvin (${VALIDATION_RANGES.cct.min}-${VALIDATION_RANGES.cct.max}). Omit device or use "all" to set all lights.`
    )
    .option(
      '-i, --intensity <value>',
      `Also set intensity (${VALIDATION_RANGES.intensity.min}-${VALIDATION_RANGES.intensity.max})`
    )
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleCct(deps)));
}

function handleCct(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (tempStr: string, deviceQuery: string | undefined, options: CommandOptions) => {
    const temperature = parseInt(tempStr, 10);
    if (
      Number.isNaN(temperature) ||
      temperature < VALIDATION_RANGES.cct.min ||
      temperature > VALIDATION_RANGES.cct.max
    ) {
      console.error(
        chalk.red(`Temperature must be between ${VALIDATION_RANGES.cct.min}K and ${VALIDATION_RANGES.cct.max}K`)
      );
      process.exit(1);
    }

    let intensity: number | undefined;
    if (options.intensity) {
      intensity = parseInt(options.intensity, 10);
      if (
        Number.isNaN(intensity) ||
        intensity < VALIDATION_RANGES.intensity.min ||
        intensity > VALIDATION_RANGES.intensity.max
      ) {
        console.error(
          chalk.red(
            `Intensity must be a number between ${VALIDATION_RANGES.intensity.min} and ${VALIDATION_RANGES.intensity.max}`
          )
        );
        process.exit(1);
      }
      intensity = intensity * 10;
    }

    const controller = await createController(options.url, options.clientId, options.debug);

    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await controller.setCCTAndIntensityForAllLights(temperature, intensity, (success: boolean, message: string) => {
        if (!success) {
          console.error(chalk.red(`✗ Failed to set temperature: ${message}`));
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

    controller.setCCT(device.node_id, temperature, intensity, (success: boolean, message: string) => {
      if (success) {
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        let msg = `✓ ${displayName} temperature set to ${temperature}K`;
        if (intensity !== undefined) {
          msg += ` at ${intensity / 10}% intensity`;
        }
        console.log(chalk.green(msg));
      } else {
        console.error(chalk.red(`✗ Failed to set temperature: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerCct;
