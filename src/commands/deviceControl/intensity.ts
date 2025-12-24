import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerIntensity(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('intensity [value] [device]')
      .description('Set or get light intensity (0-100). Omit device or use "all" for all lights.')
  )
    .option('-g, --get', 'Get current intensity instead of setting')
    .action(asyncCommand(handleIntensity(deps)));
}

function handleIntensity(deps: CommandDeps) {
  return async (intensityStr: string | undefined, deviceQuery: string | undefined, options: CommandOptions) => {
    if (options.get) {
      return runDeviceAction(
        {
          deps,
          options,
          deviceQuery,
          actionName: 'get intensity',
        },
        async (device, controller) => {
          return new Promise((resolve) => {
            controller.getIntensity(device.node_id as string, (success, message, data) => {
              if (!success) throw new Error(message);
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';

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
          const lightDevices = devices.filter(
            (d) => d.node_id?.includes('-') && d.node_id !== '00000000000000000000000000000000'
          );

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
