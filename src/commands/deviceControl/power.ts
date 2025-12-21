import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerPower(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  // on
  addStandardOptions(
    program.command('on [device]').description('Turn a light on (or all lights if no device specified)')
  ).action(asyncCommand(handleOn(deps)));

  // off
  addStandardOptions(
    program.command('off [device]').description('Turn a light off (or all lights if no device specified)')
  ).action(asyncCommand(handleOff(deps)));

  // toggle
  addStandardOptions(
    program.command('toggle [device]').description('Toggle a light on/off (or all lights if no device specified)')
  ).action(asyncCommand(handleToggle(deps)));
}

function handleOn(deps: CommandDeps) {
  return (deviceQuery: string | undefined, options: CommandOptions) =>
    runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'turn on light',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} turned on`,
      },
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.turnLightOn(device.node_id as string, (success, message) => {
              if (!success) throw new Error(message);
              resolve();
            });
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.turnOnAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to turn on light: ${message}`);
        });
      }
    );
}

function handleOff(deps: CommandDeps) {
  return (deviceQuery: string | undefined, options: CommandOptions) =>
    runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'turn off light',
        onSuccess: (device: Device) =>
          `✓ ${device.device_name || device.name || device.id || device.node_id || 'Unknown'} turned off`,
      },
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.turnLightOff(device.node_id as string, (success, message) => {
              if (!success) throw new Error(message);
              resolve();
            });
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.turnOffAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to turn off light: ${message}`);
        });
      }
    );
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
      (device) => {
        return new Promise((resolve) => {
          deps.createController(options.url, options.clientId, options.debug).then((controller) => {
            controller.toggleLight(device.node_id as string, (success, message) => {
              if (!success) throw new Error(message);
              resolve();
            });
          });
        });
      },
      async () => {
        const controller = await deps.createController(options.url, options.clientId, options.debug);
        await controller.toggleAllLights((success, message) => {
          if (!success) console.error(`✗ Failed to toggle light: ${message}`);
        });
      }
    );
}

export default registerPower;
