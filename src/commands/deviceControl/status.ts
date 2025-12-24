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
  console.log(
    `  State: ${sleep === true ? chalk.red('Off') : sleep === false ? chalk.green('On') : chalk.gray('Unknown')}`
  );

  // Work Mode
  if (config.work_mode) {
    console.log(`  Mode: ${chalk.cyan(config.work_mode)}`);
  }

  // Intensity
  if (config.intensity !== undefined) {
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
          controller.getNodeConfig(nodeId, (success: boolean, message: string, data?: unknown) => {
            if (success) {
              let config = data;
              // Handle nesting if present
              if (config && typeof config === 'object' && 'data' in config) {
                config = config.data;
              }
              printDeviceStatus(device, config as NodeConfig);
            } else {
              console.error(chalk.red(`✗ Failed to get configuration for ${nodeId}: ${message}`));
            }
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
        for (const device of devices) {
          const nodeId = device.node_id;
          if (!nodeId) continue;
          await new Promise<void>((resolve) => {
            controller.getNodeConfig(nodeId, (success, message, data?: unknown) => {
              if (success) {
                let config = data;
                // Handle nesting if present
                if (config && typeof config === 'object' && 'data' in config) {
                  config = config.data;
                }
                printDeviceStatus(device, config as NodeConfig);
              } else {
                console.error(chalk.red(`✗ Failed to get status for ${nodeId}: ${message}`));
              }
              resolve();
            });
          });
        }
      }
    );
  };
}

export default registerStatus;
