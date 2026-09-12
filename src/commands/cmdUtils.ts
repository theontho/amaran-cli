import chalk from 'chalk';
import type { Command } from 'commander';
import BleHttpController from '../deviceControl/bleHttpControl.js';
import type { CommandCallback, CommandDeps, CommandOptions, Device, LightController } from '../deviceControl/types.js';

const LIGHT_NODE_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/i;

export function isLightDevice(device: Device): boolean {
  if (device.device_type === 'ble-group') return false;
  return (
    (typeof device.node_id === 'string' && LIGHT_NODE_PATTERN.test(device.node_id)) ||
    device.backend === 'ble' ||
    device.device_type === 'ble-light'
  );
}

export function getLightDevices(devices: Device[]): Device[] {
  return devices.filter(isLightDevice);
}

export function commandCallbackPromise(register: (callback: CommandCallback) => void): Promise<void> {
  return commandCallbackResult(register).then(() => undefined);
}

export function commandCallbackResult(register: (callback: CommandCallback) => void | Promise<void>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const pending = register((success, message, data) => (success ? resolve(data) : reject(new Error(message))));
    pending?.catch(reject);
  });
}

export function requireBleController(controller: LightController): BleHttpController {
  if (!(controller instanceof BleHttpController)) throw new Error('This operation requires --backend ble');
  return controller;
}

export function getAppliedNumber(data: unknown, field: 'cct' | 'intensity'): number | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const states =
    'states' in data && data.states && typeof data.states === 'object' ? Object.values(data.states) : [data];
  const values = states.map((state) =>
    state && typeof state === 'object' ? (state as Record<string, unknown>)[field] : undefined
  );
  const first = values[0];
  return typeof first === 'number' && Number.isFinite(first) && values.every((value) => value === first)
    ? first
    : undefined;
}

/**
 * Adds standard options to a commander command
 */
export function addStandardOptions(command: Command): Command {
  return command
    .option('-b, --backend <backend>', 'Light backend: websocket or ble')
    .option('-u, --url <url>', 'Backend URL (WebSocket or BLE HTTP)')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode');
}

/**
 * Options for runDeviceAction
 */
interface DeviceActionOptions {
  deps: CommandDeps;
  options: CommandOptions;
  deviceQuery?: string;
  actionName: string;
  onSuccess?: (device: Device) => string;
}

/**
 * Common pattern for connecting, finding devices, executing an action, and disconnecting
 */
export async function runDeviceAction(
  { deps, options, deviceQuery, actionName, onSuccess }: DeviceActionOptions,
  action: (device: Device, controller: LightController) => void | Promise<void>,
  allAction: (controller: LightController) => void | Promise<void>
) {
  const { createController, findDevice } = deps;
  const controller = await createController(options.url, options.clientId, options.debug, options.backend);

  try {
    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await allAction(controller);
      return;
    }

    const device = findDevice(controller, deviceQuery);
    if (!device) {
      console.error(chalk.red(`Device "${deviceQuery}" not found`));
      process.exit(1);
    }

    if (!device.node_id) {
      console.error(chalk.red(`Device "${deviceQuery}" has no node_id`));
      process.exit(1);
    }

    await action(device, controller);

    if (onSuccess) {
      console.log(chalk.green(onSuccess(device)));
    }
  } catch (error) {
    console.error(chalk.red(`✗ Failed to ${actionName}: ${(error as Error).message}`));
    throw error;
  } finally {
    await controller.disconnect();
  }
}
