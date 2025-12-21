import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerFirmware(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const fw = program.command('firmware').description('Manage device firmware');

  addStandardOptions(fw.command('check <device>').description('Check for firmware updates')).action(
    asyncCommand(handleFirmwareCheck(deps))
  );

  addStandardOptions(fw.command('update <device>').description('Update device firmware')).action(
    asyncCommand(handleFirmwareUpdate(deps))
  );
}

function handleFirmwareCheck(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'check firmware',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.checkForUpdates(device.node_id as string, (success, message, data) => {
            if (success) {
              const displayName = device.device_name || device.name || 'Unknown';
              console.log(chalk.blue(`Firmware Status for ${displayName}:`));
              // API returns update_available boolean usually
              const available = (data as { update_available?: boolean })?.update_available;
              if (available) {
                console.log(chalk.green('Update Available!'));
              } else {
                console.log(chalk.green('Firmware is up to date.'));
              }
              console.log('Details:', data);
            } else {
              console.error(chalk.red(`✗ Failed to check firmware: ${message}`));
            }
            resolve();
          });
        });
      },
      () => Promise.resolve()
    );
  };
}

function handleFirmwareUpdate(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'update firmware',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          // Ask for confirmation? For CLI automation often skip.
          // In a real app we might prompt.
          console.log(chalk.yellow(`Initiating firmware update for ${device.device_name || device.node_id}...`));

          controller.updateFirmware(device.node_id as string, (success, message, data) => {
            if (success) {
              console.log(chalk.green('✓ Update command sent successfully'));
              console.log('Response:', data);
            } else {
              console.error(chalk.red(`✗ Failed to start update: ${message}`));
            }
            resolve();
          });
        });
      },
      () => Promise.resolve()
    );
  };
}

export default registerFirmware;
