import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerIntensity(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('intensity <value> [device]')
      .description('Set light intensity (0-100). Omit device or use "all" to set all lights.')
  ).action(asyncCommand(handleIntensity(deps)));
}

function handleIntensity(deps: CommandDeps) {
  return async (intensityStr: string, deviceQuery: string | undefined, options: CommandOptions) => {
    const intensity = parseInt(intensityStr, 10);
    if (Number.isNaN(intensity) || intensity < 0 || intensity > 100) {
      console.error(chalk.red('Intensity must be a number between 0 and 100'));
      process.exit(1);
    }

    // Convert 0-100 user input to 0-1000 API range
    const apiIntensity = intensity * 10;

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set intensity',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} intensity set to ${intensity}%`,
      },
      (device, controller) => {
        return new Promise((resolve) => {
          controller.setIntensity(device.node_id as string, apiIntensity, (success, message) => {
            if (!success) throw new Error(message);
            resolve();
          });
        });
      },
      async (controller) => {
        await controller.setIntensityForAllLights(apiIntensity, (success, message) => {
          if (!success) console.error(`✗ Failed to set intensity: ${message}`);
        });
      }
    );
  };
}

export default registerIntensity;
