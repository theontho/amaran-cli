import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerColor(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('color [color] [device]')
      .description(
        'Set or get color by name or hex code (e.g., "red", "#ff0000"). Omit device or use "all" for all lights.'
      )
  )
    .option('-i, --intensity <value>', 'Set intensity (0-100)')
    .option('-g, --get', 'Get current color status')
    .action(asyncCommand(handleColor(deps)));
}

function handleColor(deps: CommandDeps) {
  return async (colorStr: string | undefined, deviceQuery: string | undefined, options: CommandOptions) => {
    // Handle get mode
    if (options.get) {
      // Argument shifting: if only one arg provided and it might be a device (or if colorStr is undefined)
      // For color command, if user types `color -g mydevice`, colorStr will be "mydevice".
      // If user types `color -g`, colorStr is undefined.
      let targetDevice = deviceQuery;
      if (!targetDevice && colorStr) {
        // If colorStr does not look like a color (hex/name) but might be a device?
        // Actually, if fetching, we don't care about color arg. So whatever is passed is likely the device or ignored.
        // It's safer to treat the first arg as device if getting.
        targetDevice = colorStr;
      }

      return runDeviceAction(
        {
          deps,
          options,
          deviceQuery: targetDevice,
          actionName: 'get color',
        },
        async (device, controller) => {
          // We use getNodeConfig initially
          return new Promise((resolve) => {
            controller.getNodeConfig(device.node_id as string, async (_success, _messagee, data) => {
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';

              // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
              const config = (data as any)?.data || data || {};

              const h = config.hue ?? config.h;
              const s = config.saturation ?? config.sat ?? config.s;
              let i = config.intensity ?? config.int ?? config.i;
              let cct = config.cct;

              // If state is missing, try explicit getters for reliable props (CCT, Intensity)
              // We skip getHSI as it is invalid on server
              if (h === undefined && s === undefined && cct === undefined) {
                // Try getting CCT
                await new Promise<void>((r) => {
                  controller.getCCT(device.node_id as string, (ok, _msg, d) => {
                    if (ok) {
                      const inner = (d as any)?.data ?? d;
                      const val = typeof inner === 'number' ? inner : inner?.cct;
                      if (val !== undefined) cct = val;
                    }
                    r();
                  });
                });

                // Try getting Intensity
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
              const parts: string[] = [];

              if (h !== undefined && s !== undefined) {
                parts.push(`HSI(${h}, ${s}, ${i !== undefined ? i / 10 : '?'})`);
              } else if (cct !== undefined) {
                parts.push(`CCT: ${cct}K`);
              }

              if (i !== undefined && (parts.length === 0 || !parts[0].includes('HSI'))) {
                parts.push(`Intensity: ${i / 10}%`);
              }

              if (parts.length === 0) {
                parts.push('Unknown state');
              }

              output += parts.join(', ');
              console.log(chalk.green(output));
              resolve();
            });
          });
        },
        async (controller) => {
          // Apply to all devices loop
          const devices = controller.getDevices();
          if (devices.length === 0) {
            console.log(chalk.yellow('No devices found'));
            return;
          }
          // Filter for light devices only
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
                  let cct = config.cct;

                  if (h === undefined && s === undefined && cct === undefined) {
                    await new Promise<void>((r) => {
                      controller.getCCT(device.node_id as string, (ok, _msg, d) => {
                        if (ok) {
                          const inner = (d as any)?.data ?? d;
                          const val = typeof inner === 'number' ? inner : inner?.cct;
                          if (val !== undefined) cct = val;
                        }
                        r();
                      });
                    });

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

                  const parts: string[] = [];
                  if (h !== undefined && s !== undefined) {
                    parts.push(`HSI(${h}, ${s}, ${i !== undefined ? i / 10 : '?'})`);
                  } else if (cct !== undefined) {
                    parts.push(`CCT: ${cct}K`);
                  }

                  if (i !== undefined && (parts.length === 0 || !parts[0].includes('HSI'))) {
                    parts.push(`Intensity: ${i / 10}%`);
                  }

                  if (parts.length === 0) parts.push('Unknown state');

                  console.log(chalk.green(`✓ ${displayName}: ${parts.join(', ')}`));
                  resolve();
                });
              });
            }
          }
        }
      );
    }

    // Set mode (original logic)
    if (!colorStr) {
      console.error(chalk.red("error: missing required argument 'color'"));
      process.exit(1);
    }

    const color = colorStr;
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
      (device, controller) => {
        return new Promise((resolve) => {
          controller.setColor(device.node_id as string, color, intensity, (success, message) => {
            if (!success) throw new Error(message);
            resolve();
          });
        });
      },
      async (controller) => {
        await controller.setColorForAllLights(color, intensity, (success, message) => {
          if (!success) console.error(`✗ Failed to set color: ${message}`);
        });
      }
    );
  };
}

export default registerColor;
