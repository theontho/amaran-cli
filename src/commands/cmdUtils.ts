import chalk from 'chalk';
import type { Command } from 'commander';
import type LightController from '../deviceControl/lightControl.js';
import type { CommandDeps, CommandOptions, Device } from '../deviceControl/types.js';

/**
 * Adds standard options to a commander command
 */
export function addStandardOptions(command: Command): Command {
  return command
    .option('-u, --url <url>', 'WebSocket URL')
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
  const controller = await createController(options.url, options.clientId, options.debug);

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
  } finally {
    await controller.disconnect();
  }
}
