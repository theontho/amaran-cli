import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device, NodeConfig } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerStatus(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program.command('status [device]').description('Get the current status of light(s). Omit device to show all.')
  ).action(asyncCommand(handleStatus(deps)));
}

function printDeviceStatus(device: Device, config: NodeConfig | undefined) {
  const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
  console.log(chalk.blue(`Status for ${displayName} (${device.node_id}):`));

  if (!config) {
    console.log(chalk.yellow('  No configuration data available.'));
    return;
  }

  // Basic State
  const sleep = config.sleep as boolean | undefined;
  // Sleep true = Off, Sleep false = On
  console.log(
    `  State: ${sleep === true ? chalk.red('Off') : sleep === false ? chalk.green('On') : chalk.gray('Unknown')}`
  );

  // Work Mode
  if (config.work_mode) {
    console.log(`  Mode: ${chalk.cyan(config.work_mode)}`);
  }

  // Intensity
  if (config.intensity !== undefined) {
    // API usually returns 0-1000 for 0-100.0%
    const intensity = (config.intensity as number) / 10;
    console.log(`  Intensity: ${intensity}%`);
  }

  // CCT
  if (config.cct !== undefined) {
    console.log(`  Temperature: ${config.cct}K`);
  }

  // HSI
  if (config.hue !== undefined && config.sat !== undefined) {
    console.log(`  HSI: Hue:${config.hue}° Sat:${config.sat}%`);
  }

  // RGB
  if (config.r !== undefined || config.g !== undefined || config.b !== undefined) {
    console.log(`  RGB: R:${config.r ?? 0} G:${config.g ?? 0} B:${config.b ?? 0}`);
  }

  // XY
  if (config.x !== undefined && config.y !== undefined) {
    console.log(`  XY: X:${config.x} Y:${config.y}`);
  }

  // Fan
  if (config.fan_mode !== undefined || config.fan_speed !== undefined) {
    let fanInfo = '  Fan:';
    if (config.fan_mode !== undefined) fanInfo += ` Mode:${config.fan_mode}`;
    if (config.fan_speed !== undefined) fanInfo += ` Speed:${config.fan_speed}`;
    console.log(fanInfo);
  }

  // Effects
  if (config.effect_type) {
    console.log(`  System Effect: ${config.effect_type}`);
  }
  if (config.effect_name) {
    console.log(`  Custom Effect: ${config.effect_name}`);
  }
}

function handleStatus(deps: CommandDeps) {
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'get status',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          const nodeId = device.node_id as string;
          controller.getNodeConfig(nodeId, async (success: boolean, _message: string, data?: unknown) => {
            let config: Record<string, unknown> = {};

            if (success) {
              config =
                ((data as Record<string, unknown>)?.data as Record<string, unknown>) ||
                (data as Record<string, unknown>) ||
                {};
            } else {
              // If getNodeConfig fails, we start with empty and try to fill it
              if (options.debug)
                console.log(chalk.gray(`getNodeConfig failed/incomplete for ${nodeId}, trying individual getters...`));
            }

            // Fallback: Fetch specific states if missing from config
            const promises: Promise<void>[] = [];

            // 1. Power State (Sleep)
            if (config.sleep === undefined) {
              promises.push(
                new Promise<void>((r) => {
                  controller.getLightSleepStatus(nodeId, (ok, _msg, d) => {
                    if (ok) {
                      const inner = (d as Record<string, unknown>)?.data ?? d;
                      const val = typeof inner === 'boolean' ? inner : (inner as Record<string, unknown>)?.sleep;
                      if (val !== undefined) config.sleep = val;
                    }
                    r();
                  });
                })
              );
            }

            // 2. CCT
            if (config.cct === undefined) {
              promises.push(
                new Promise<void>((r) => {
                  controller.getCCT(nodeId, (ok, _msg, d) => {
                    if (ok) {
                      const inner = (d as Record<string, unknown>)?.data ?? d;
                      const val = typeof inner === 'number' ? inner : (inner as Record<string, unknown>)?.cct;
                      if (val !== undefined) config.cct = val;
                    }
                    r();
                  });
                })
              );
            }

            // 3. Intensity
            if (config.intensity === undefined && config.int === undefined && config.i === undefined) {
              promises.push(
                new Promise<void>((r) => {
                  controller.getIntensity(nodeId, (ok, _msg, d) => {
                    if (ok) {
                      const inner = (d as Record<string, unknown>)?.data ?? d;
                      const val = typeof inner === 'number' ? inner : (inner as Record<string, unknown>)?.intensity;
                      if (val !== undefined) config.intensity = val;
                    }
                    r();
                  });
                })
              );
            }

            // Wait for all fallbacks
            await Promise.all(promises);

            printDeviceStatus(device, config as NodeConfig);
            resolve();
          });
        });
      },
      async (controller) => {
        const devices = controller.getDevices();
        if (devices.length === 0) {
          console.log(chalk.yellow('No devices found.'));
          return;
        }

        console.log(chalk.bold(`Fetching status for ${devices.length} device(s)...`));
        // Filter for valid devices
        const lightDevices = devices.filter(
          (d) => d.node_id?.includes('-') && d.node_id !== '00000000000000000000000000000000'
        );

        if (lightDevices.length === 0) {
          console.log(chalk.yellow('No light devices found.'));
          return;
        }

        for (const device of lightDevices) {
          const nodeId = device.node_id;
          if (!nodeId) continue;
          await new Promise<void>((resolve) => {
            controller.getNodeConfig(nodeId, async (success, _message, data?: unknown) => {
              let config: Record<string, unknown> = {};
              if (success) {
                config =
                  ((data as Record<string, unknown>)?.data as Record<string, unknown>) ||
                  (data as Record<string, unknown>) ||
                  {};
              }

              const promises: Promise<void>[] = [];

              if (config.sleep === undefined) {
                promises.push(
                  new Promise<void>((r) => {
                    controller.getLightSleepStatus(nodeId, (ok, _msg, d) => {
                      if (ok) {
                        const inner = (d as Record<string, unknown>)?.data ?? d;
                        const val = typeof inner === 'boolean' ? inner : (inner as Record<string, unknown>)?.sleep;
                        if (val !== undefined) config.sleep = val;
                      }
                      r();
                    });
                  })
                );
              }

              if (config.cct === undefined) {
                promises.push(
                  new Promise<void>((r) => {
                    controller.getCCT(nodeId, (ok, _msg, d) => {
                      if (ok) {
                        const inner = (d as Record<string, unknown>)?.data ?? d;
                        const val = typeof inner === 'number' ? inner : (inner as Record<string, unknown>)?.cct;
                        if (val !== undefined) config.cct = val;
                      }
                      r();
                    });
                  })
                );
              }

              if (config.intensity === undefined) {
                promises.push(
                  new Promise<void>((r) => {
                    controller.getIntensity(nodeId, (ok, _msg, d) => {
                      if (ok) {
                        const inner = (d as Record<string, unknown>)?.data ?? d;
                        const val = typeof inner === 'number' ? inner : (inner as Record<string, unknown>)?.intensity;
                        if (val !== undefined) config.intensity = val;
                      }
                      r();
                    });
                  })
                );
              }

              await Promise.all(promises);

              printDeviceStatus(device, config as NodeConfig);
              console.log(''); // Newline between devices
              resolve();
            });
          });
        }
      }
    );
  };
}

export default registerStatus;
