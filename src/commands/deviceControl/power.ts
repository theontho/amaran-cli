import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerPower(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  // on
  addStandardOptions(
    program.command('on [device]').description('Turn a light on or get status (or all lights if no device specified)')
  )
    .option('-g, --get', 'Get current status instead of turning on')
    .action(asyncCommand(handleOn(deps)));

  // off
  addStandardOptions(
    program.command('off [device]').description('Turn a light off or get status (or all lights if no device specified)')
  )
    .option('-g, --get', 'Get current status instead of turning off')
    .action(asyncCommand(handleOff(deps)));

  // toggle
  addStandardOptions(
    program.command('toggle [device]').description('Toggle a light on/off (or all lights if no device specified)')
  ).action(asyncCommand(handleToggle(deps)));
}

async function getPowerStatus(
  deps: CommandDeps,
  deviceQuery: string | undefined,
  options: CommandOptions,
  _actionName: string
) {
  return runDeviceAction(
    {
      deps,
      options,
      deviceQuery,
      actionName: 'get power status',
    },
    async (device, controller) => {
      return new Promise((resolve) => {
        controller.getLightSleepStatus(device.node_id as string, (success, message, data) => {
          if (!success) throw new Error(message);
          const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';

          // Handle potential nesting: { data: { data: false } } or { data: { sleep: false } }
          let state = data;
          if (state && typeof state === 'object' && 'data' in state) {
            const innerData = (state as { data: unknown }).data;
            if (typeof innerData === 'boolean') {
              state = { sleep: innerData };
            } else {
              state = innerData;
            }
          }

          // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
          const s = state as any;
          // sleep = true means OFF, sleep = false means ON
          const sleepVal = typeof state === 'boolean' ? state : s?.sleep;
          const status = sleepVal === undefined ? 'Unknown' : sleepVal ? 'OFF' : 'ON';

          console.log(chalk.green(`✓ ${displayName}: ${status}`));
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
            controller.getLightSleepStatus(device.node_id as string, (success, message, data) => {
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
              if (success) {
                let state = data;
                if (state && typeof state === 'object' && 'data' in state) {
                  const innerData = (state as { data: unknown }).data;
                  if (typeof innerData === 'boolean') {
                    state = { sleep: innerData };
                  } else {
                    state = innerData;
                  }
                }
                // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
                const s = state as any;
                const sleepVal = typeof state === 'boolean' ? state : s?.sleep;
                const status = sleepVal === undefined ? 'Unknown' : sleepVal ? 'OFF' : 'ON';

                console.log(chalk.green(`✓ ${displayName}: ${status}`));
              } else {
                console.error(chalk.red(`✗ ${displayName}: Failed to get status: ${message}`));
              }
              resolve();
            });
          });
        }
      }
    }
  );
}

function handleOn(deps: CommandDeps) {
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    if (options.get) {
      return getPowerStatus(deps, deviceQuery, options, 'get status');
    }
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'turn on light',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} turned on`,
      },
      (device, controller) => {
        return new Promise((resolve) => {
          controller.turnLightOn(device.node_id as string, (success, message) => {
            if (!success) throw new Error(message);
            resolve();
          });
        });
      },
      async (controller) => {
        await controller.turnOnAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to turn on light: ${message}`);
        });
      }
    );
  };
}

function handleOff(deps: CommandDeps) {
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    if (options.get) {
      return getPowerStatus(deps, deviceQuery, options, 'get status');
    }
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'turn off light',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} turned off`,
      },
      (device, controller) => {
        return new Promise((resolve) => {
          controller.turnLightOff(device.node_id as string, (success, message) => {
            if (!success) throw new Error(message);
            resolve();
          });
        });
      },
      async (controller) => {
        await controller.turnOffAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to turn off light: ${message}`);
        });
      }
    );
  };
}

function handleToggle(deps: CommandDeps) {
  return (deviceQuery: string | undefined, options: CommandOptions) =>
    runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'toggle light',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} toggled`,
      },
      (device, controller) => {
        return new Promise((resolve) => {
          controller.toggleLight(device.node_id as string, (success, message) => {
            if (!success) throw new Error(message);
            resolve();
          });
        });
      },
      async (controller) => {
        await controller.toggleAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to toggle light: ${message}`);
        });
      }
    );
}

export default registerPower;
