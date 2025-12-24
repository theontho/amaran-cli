import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerHsi(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('hsi [hue] [saturation] [intensity] [device]')
      .description(
        'Set or get HSI color (hue: 0-360, saturation: 0-100, intensity: 0-100). Omit device or use "all" for all lights.'
      )
  )
    .option('-g, --get', 'Get current HSI color instead of setting')
    .action(asyncCommand(handleHsi(deps)));
}

function handleHsi(deps: CommandDeps) {
  return async (
    hueStr: string | undefined,
    satStr: string | undefined,
    intStr: string | undefined,
    deviceQuery: string | undefined,
    options: CommandOptions
  ) => {
    if (options.get) {
      // If getting, handle potential argument shifting
      // If only the first arg is provided, it's likely the device name
      let targetDevice = deviceQuery;
      if (!targetDevice && hueStr && !satStr && !intStr) {
        targetDevice = hueStr;
      }

      return runDeviceAction(
        {
          deps,
          options,
          deviceQuery: targetDevice,
          actionName: 'get HSI color',
        },
        async (device, controller) => {
          return new Promise((resolve) => {
            controller.getNodeConfig(device.node_id as string, async (_success, _messagee, data) => {
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';

              // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
              const config = (data as any)?.data || data || {};

              const h = config.hue ?? config.h;
              const s = config.saturation ?? config.sat ?? config.s;
              let i = config.intensity ?? config.int ?? config.i;

              // If state is missing, try explicit getters
              // We skip getHSI as it is invalid on server
              if (h === undefined && s === undefined) {
                // Optimization: In CCT mode, we might not have hue/sat.
                // But if the server provides no HSI getter, we can only rely on config or context.
                // If config is empty, we try getting Intensity at least.

                await new Promise<void>((r) => {
                  controller.getIntensity(device.node_id as string, (ok, _msg, d) => {
                    if (ok) {
                      const inner = (d as any)?.data ?? d;
                      const val = typeof inner === 'number' ? inner : inner?.intensity;
                      if (val !== undefined) i = val;
                    }
                    r();
                  });
                });
              }

              let output = `✓ ${displayName}: `;
              if (h !== undefined && s !== undefined) {
                output += `H:${h} S:${s} I:${i !== undefined ? i / 10 : '?'}`;
              } else {
                if (i !== undefined) {
                  output += `Intensity: ${i / 10}% (HSI unknown)`;
                } else {
                  output += 'Unknown state';
                }
              }

              console.log(chalk.green(output));
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
                controller.getNodeConfig(device.node_id as string, async (_success, _messagee, data) => {
                  const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
                  // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
                  const config = (data as any)?.data || data || {};

                  const h = config.hue ?? config.h;
                  const s = config.saturation ?? config.sat ?? config.s;
                  let i = config.intensity ?? config.int ?? config.i;

                  if (h === undefined && s === undefined) {
                    await new Promise<void>((r) => {
                      controller.getIntensity(device.node_id as string, (ok, _msg, d) => {
                        if (ok) {
                          const inner = (d as any)?.data ?? d;
                          const val = typeof inner === 'number' ? inner : inner?.intensity;
                          if (val !== undefined) i = val;
                        }
                        r();
                      });
                    });
                  }

                  let output = `✓ ${displayName}: `;
                  if (h !== undefined && s !== undefined) {
                    output += `H:${h} S:${s} I:${i !== undefined ? i / 10 : '?'}`;
                  } else {
                    if (i !== undefined) {
                      output += `Intensity: ${i / 10}% (HSI unknown)`;
                    } else {
                      output += 'Unknown state';
                    }
                  }
                  console.log(chalk.green(output));
                  resolve();
                });
              });
            }
          }
        }
      );
    }

    if (!hueStr || !satStr || !intStr) {
      console.error(chalk.red('Hue, saturation, and intensity are required unless using --get'));
      process.exit(1);
    }

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
      (device, controller) => {
        return new Promise((resolve) => {
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
      },
      async (controller) => {
        await controller.setHSIForAllLights(hue, saturation, apiIntensity, undefined, undefined, (success, message) => {
          if (!success) console.error(`✗ Failed to set HSI color: ${message}`);
        });
      }
    );
  };
}

export default registerHsi;
