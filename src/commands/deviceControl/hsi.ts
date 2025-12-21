import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerHsi(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('hsi <hue> <saturation> <intensity> [device]')
      .description(
        'Set HSI color (hue: 0-360, saturation: 0-100, intensity: 0-100). Omit device or use "all" to set all lights.'
      )
  ).action(asyncCommand(handleHsi(deps)));
}

function handleHsi(deps: CommandDeps) {
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

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set HSI color',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} color set to H:${hue} S:${saturation} I:${intensity}`,
      },
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.setHSI(
              device.node_id as string,
              hue,
              saturation,
              apiIntensity,
              undefined,
              undefined,
              (success, message) => {
                if (!success) throw new Error(message);
                resolve();
              }
            );
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.setHSIForAllLights(hue, saturation, apiIntensity, undefined, undefined, (success, message) => {
          if (!success) console.error(`✗ Failed to set HSI color: ${message}`);
        });
      }
    );
  };
}

export default registerHsi;
