import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerFan(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const fan = program.command('fan').description('Control fan settings');

  addStandardOptions(
    fan.command('mode <device> <mode>').description('Set fan mode (e.g. 0=Auto, 1=Smart, 2=High, 3=Medium, 4=Silent)')
  ).action(asyncCommand(handleFanMode(deps)));

  addStandardOptions(fan.command('speed <device> <speed>').description('Set fan speed')).action(
    asyncCommand(handleFanSpeed(deps))
  );

  addStandardOptions(fan.command('info <device>').description('Get fan status')).action(
    asyncCommand(handleFanInfo(deps))
  );
}

function handleFanMode(deps: CommandDeps) {
  return async (deviceQuery: string, modeStr: string, options: CommandOptions) => {
    const mode = parseInt(modeStr, 10);
    if (Number.isNaN(mode)) {
      console.error(chalk.red('Fan mode must be a number'));
      return;
    }

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set fan mode to ${mode}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setFanMode(device.node_id as string, mode, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Fan mode set to ${mode} on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set fan mode: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk fan control not supported.'));
        return Promise.resolve();
      }
    );
  };
}

function handleFanSpeed(deps: CommandDeps) {
  return async (deviceQuery: string, speedStr: string, options: CommandOptions) => {
    const speed = parseInt(speedStr, 10);
    if (Number.isNaN(speed)) {
      console.error(chalk.red('Fan speed must be a number'));
      return;
    }

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set fan speed to ${speed}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setFanSpeed(device.node_id as string, speed, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Fan speed set to ${speed} on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set fan speed: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk fan control not supported.'));
        return Promise.resolve();
      }
    );
  };
}

function handleFanInfo(deps: CommandDeps) {
  return async (deviceQuery: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'get fan status',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          const nodeId = device.node_id as string;
          controller.getFanMode(nodeId, (success, message, mode) => {
            if (success) {
              controller.getFanSpeed(nodeId, (successSpeed, _, speed) => {
                const displayName = device.device_name || device.name || 'Unknown';
                console.log(chalk.blue(`Fan Information for ${displayName}:`));
                console.log(`  Mode:  ${mode}`);
                if (successSpeed) {
                  console.log(`  Speed: ${speed}`);
                }
                resolve();
              });
            } else {
              console.error(chalk.red(`✗ Failed to get fan info: ${message}`));
              resolve();
            }
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk fan info not supported.'));
        return Promise.resolve();
      }
    );
  };
}

export default registerFan;
