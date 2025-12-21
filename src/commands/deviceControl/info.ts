import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerInfo(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const info = program.command('info').description('Get detailed device info');

  addStandardOptions(info.command('device <device>').description('Get device hardware/firmware info')).action(
    asyncCommand(handleDeviceInfo(deps))
  );

  addStandardOptions(info.command('protocol').description('Get supported protocol versions')).action(
    asyncCommand(handleProtocolInfo(deps))
  );
}

function handleDeviceInfo(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'get device info',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          const nodeId = device.node_id as string;

          // Parallel requests? Or sequential. Sequential is safer.
          controller.getDeviceInfo(nodeId, (success, message, info) => {
            if (success) {
              controller.getFirmwareVersion(nodeId, (fwSuccess, _, fwInfo) => {
                const displayName = device.device_name || device.name || 'Unknown';
                console.log(chalk.blue(`Information for ${displayName}:`));
                console.log('Device Info:', JSON.stringify(info, null, 2));
                if (fwSuccess) {
                  console.log('Firmware:', JSON.stringify(fwInfo, null, 2));
                }
                resolve();
              });
            } else {
              console.error(chalk.red(`✗ Failed to get device info: ${message}`));
              resolve();
            }
          });
        });
      },
      () => Promise.resolve()
    );
  };
}

function handleProtocolInfo(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.getProtocolVersions((success, message, data) => {
      if (success) {
        console.log(chalk.blue('Supported Protocol Versions:'), data);
      } else {
        console.error(chalk.red(`Error getting protocols: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerInfo;
