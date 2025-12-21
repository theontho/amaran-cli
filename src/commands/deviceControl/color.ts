import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerColor(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('color <color> [device]')
      .description(
        'Set color by name or hex code (e.g., "red", "#ff0000"). Omit device or use "all" to set all lights.'
      )
  )
    .option('-i, --intensity <value>', 'Set intensity (0-100)')
    .action(asyncCommand(handleColor(deps)));
}

function handleColor(deps: CommandDeps) {
  return async (color: string, deviceQuery: string | undefined, options: CommandOptions) => {
    let intensity: number | undefined;
    if (options.intensity) {
      intensity = parseInt(options.intensity as string, 10);
      if (Number.isNaN(intensity) || intensity < 0 || intensity > 100) {
        console.error(chalk.red('Intensity must be a number between 0 and 100'));
        process.exit(1);
      }
      intensity = intensity * 10;
    }

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set color',
        onSuccess: (device: Device) => {
          const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
          let msg = `✓ ${displayName} color set to ${color}`;
          if (intensity !== undefined) {
            msg += ` at ${intensity / 10}% intensity`;
          }
          return msg;
        },
      },
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.setColor(device.node_id as string, color, intensity, (success, message) => {
              if (!success) throw new Error(message);
              resolve();
            });
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.setColorForAllLights(color, intensity, (success, message) => {
          if (!success) console.error(`✗ Failed to set color: ${message}`);
        });
      }
    );
  };
}

export default registerColor;
