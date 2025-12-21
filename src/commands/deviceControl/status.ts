import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerStatus(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(program.command('status <device>').description('Get the current status of a light')).action(
    asyncCommand(handleStatus(deps))
  );
}

function handleStatus(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
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
          controller.getLightSleepStatus(nodeId, (success: boolean, message: string, data?: unknown) => {
            if (success) {
              const nodeConfig = controller.getNode(nodeId);
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
              console.log(chalk.blue(`Status for ${displayName}:`));
              console.log(`  State: ${(data as { sleep?: boolean })?.sleep ? chalk.red('Off') : chalk.green('On')}`);

              if (nodeConfig) {
                if (nodeConfig.intensity !== undefined) {
                  console.log(`  Intensity: ${nodeConfig.intensity}%`);
                }
                if (nodeConfig.cct !== undefined) {
                  console.log(`  Temperature: ${nodeConfig.cct}K`);
                }
                if (nodeConfig.hue !== undefined && nodeConfig.sat !== undefined) {
                  console.log(`  HSI: H:${nodeConfig.hue} S:${nodeConfig.sat} I:${nodeConfig.intensity}`);
                }
              }
            } else {
              console.error(chalk.red(`✗ Failed to get status: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Status command requires a specific device name or ID.'));
        console.log(chalk.gray('Use "list" to see available devices.'));
      }
    );
  };
}

export default registerStatus;
