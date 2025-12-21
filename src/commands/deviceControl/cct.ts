import chalk from 'chalk';
import type { Command } from 'commander';
import { VALIDATION_RANGES } from '../../deviceControl/constants.js';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerCct(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('cct <temperature> [device]')
      .usage('<temperature> [device] [options]')
      .description(
        `Set color temperature in Kelvin (${VALIDATION_RANGES.cct.min}-${VALIDATION_RANGES.cct.max}). Omit device or use "all" to set all lights.`
      )
  )
    .option(
      '-i, --intensity <value>',
      `Also set intensity (${VALIDATION_RANGES.intensity.min}-${VALIDATION_RANGES.intensity.max})`
    )
    .action(asyncCommand(handleCct(deps)));
}

function handleCct(deps: CommandDeps) {
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
      intensity = parseInt(options.intensity as string, 10);
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

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set temperature',
        onSuccess: (device: Device) => {
          const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
          let msg = `✓ ${displayName} temperature set to ${temperature}K`;
          if (intensity !== undefined) {
            msg += ` at ${intensity / 10}% intensity`;
          }
          return msg;
        },
      },
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.setCCT(device.node_id as string, temperature, intensity, (success, message) => {
              if (!success) throw new Error(message);
              resolve();
            });
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.setCCTAndIntensityForAllLights(temperature, intensity, (success, message) => {
          if (!success) console.error(`✗ Failed to set temperature: ${message}`);
        });
      }
    );
  };
}

export default registerCct;
