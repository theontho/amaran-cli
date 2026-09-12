import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import {
  addStandardOptions,
  commandCallbackPromise,
  getAppliedNumber,
  getLightDevices,
  runDeviceAction,
} from '../cmdUtils.js';

export function registerIntensity(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('intensity [value] [device]')
      .description('Set or get light intensity (0-100). Omit device or use "all" for all lights.')
  )
    .option('-g, --get', 'Get current intensity instead of setting')
    .option('--relative', 'Apply a signed brightness change in percentage points, clamped to 0-100')
    .action(asyncCommand(handleIntensity(deps)));
}

function handleIntensity(deps: CommandDeps) {
  return async (intensityStr: string | undefined, deviceQuery: string | undefined, options: CommandOptions) => {
    if (options.get) {
      const targetDevice = deviceQuery ?? intensityStr;

      return runDeviceAction(
        {
          deps,
          options,
          deviceQuery: targetDevice,
          actionName: 'get intensity',
        },
        async (device, controller) => {
          return new Promise((resolve) => {
            controller.getIntensity(device.node_id as string, (success, message, data) => {
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
              if (!success) {
                console.error(chalk.red(`✗ ${displayName}: Failed to get intensity: ${message}`));
                resolve();
                return;
              }

              // Handle potential nesting: { data: { data: 500 } }
              let state = data;
              if (state && typeof state === 'object' && 'data' in state) {
                const innerData = (state as { data: unknown }).data;
                // If nested data is just a number, that's our intensity
                if (typeof innerData === 'number') {
                  state = innerData;
                } else {
                  // Fallback if it's an object inside data
                  state = innerData;
                }
              }

              // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
              const s = state as any;
              // Some servers return the value directly
              const intensityVal = typeof state === 'number' ? state : s?.intensity;

              const displayIntensity = typeof intensityVal === 'number' ? intensityVal / 10 : 'unknown';

              console.log(chalk.green(`✓ ${displayName}: ${displayIntensity}%`));
              resolve();
            });
          });
        },
        async (controller) => {
          const devices = controller.getDevices();
          if (devices.length === 0) {
            console.log(chalk.yellow('No devices found'));
            return;
          }

          // Filter for light devices only, skipping groups like 'ALL'
          const lightDevices = getLightDevices(devices);

          if (lightDevices.length === 0) {
            console.log(chalk.yellow('No light devices found'));
            return;
          }

          for (const device of lightDevices) {
            if (device.node_id) {
              await new Promise<void>((resolve) => {
                controller.getIntensity(device.node_id as string, (success, message, data) => {
                  const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
                  if (success) {
                    let state = data;
                    if (state && typeof state === 'object' && 'data' in state) {
                      const innerData = (state as { data: unknown }).data;
                      if (typeof innerData === 'number') {
                        state = innerData;
                      } else {
                        state = innerData;
                      }
                    }
                    // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
                    const s = state as any;
                    const intensityVal = typeof state === 'number' ? state : s?.intensity;
                    const displayIntensity = typeof intensityVal === 'number' ? intensityVal / 10 : 'unknown';

                    console.log(chalk.green(`✓ ${displayName}: ${displayIntensity}%`));
                  } else {
                    console.error(chalk.red(`✗ ${displayName}: Failed to get intensity: ${message}`));
                  }
                  resolve();
                });
              });
            }
          }
        }
      );
    }

    if (!intensityStr) {
      console.error(chalk.red('Error: value is required unless using --get'));
      process.exit(1);
    }

    const intensity = Number(intensityStr);
    if (!Number.isFinite(intensity) || intensity < (options.relative ? -100 : 0) || intensity > 100) {
      console.error(
        chalk.red(
          options.relative
            ? 'Relative intensity must be between -100 and 100'
            : 'Intensity must be a number between 0 and 100'
        )
      );
      process.exit(1);
    }

    // Convert 0-100 user input to 0-1000 API range
    const apiIntensity = intensity * 10;
    let appliedIntensity: number | undefined;

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set intensity',
        onSuccess: (device: Device) => {
          const name = device.device_name || device.name || device.id || device.node_id || 'Unknown';
          return options.relative
            ? `✓ ${name} intensity adjusted${appliedIntensity === undefined ? '' : ` to ${appliedIntensity}%`} (relative request ${intensity}%)`
            : `✓ ${name} intensity set to ${appliedIntensity ?? intensity}%`;
        },
      },
      (device, controller) => {
        return commandCallbackPromise((callback) => {
          const apply = options.relative
            ? controller.incrementIntensity.bind(controller)
            : controller.setIntensity.bind(controller);
          apply(device.node_id as string, apiIntensity, (success, message, data) => {
            const observed = success ? getAppliedNumber(data, 'intensity') : undefined;
            if (observed !== undefined) appliedIntensity = observed / 10;
            callback(success, message, data);
          });
        });
      },
      async (controller) => {
        const apply = options.relative
          ? controller.incrementIntensityForAllLights.bind(controller)
          : controller.setIntensityForAllLights.bind(controller);
        await apply(apiIntensity, (success, message) => {
          if (!success) {
            process.exitCode = 1;
            console.error(`✗ Failed to set intensity: ${message}`);
          }
        });
      }
    );
  };
}

export default registerIntensity;
