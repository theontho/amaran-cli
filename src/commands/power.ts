import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types.js';

export function registerPower(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  // on
  program
    .command('on [device]')
    .description('Turn a light on (or all lights if no device specified)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleOn(deps)));

  // off
  program
    .command('off [device]')
    .description('Turn a light off (or all lights if no device specified)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleOff(deps)));

  // toggle
  program
    .command('toggle [device]')
    .description('Toggle a light on/off (or all lights if no device specified)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleToggle(deps)));
}

function handleOn(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await controller.turnOnAllLights((success: boolean, message: string) => {
        if (!success) {
          console.error(chalk.red(`✗ Failed to turn on light: ${message}`));
        }
      });
      await controller.disconnect();
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

    controller.turnLightOn(device.node_id, (success: boolean, message: string) => {
      if (success) {
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        console.log(chalk.green(`✓ ${displayName} turned on`));
      } else {
        console.error(chalk.red(`✗ Failed to turn on light: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleOff(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await controller.turnOffAllLights((success: boolean, message: string) => {
        if (!success) {
          console.error(chalk.red(`✗ Failed to turn off light: ${message}`));
        }
      });
      await controller.disconnect();
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

    controller.turnLightOff(device.node_id, (success: boolean, message: string) => {
      if (success) {
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        console.log(chalk.green(`✓ ${displayName} turned off`));
      } else {
        console.error(chalk.red(`✗ Failed to turn off light: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleToggle(deps: CommandDeps) {
  const { createController, findDevice } = deps;
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    if (!deviceQuery || deviceQuery.toLowerCase() === 'all') {
      await controller.toggleAllLights((success: boolean, message: string) => {
        if (!success) {
          console.error(chalk.red(`✗ Failed to toggle light: ${message}`));
        }
      });
      await controller.disconnect();
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

    controller.toggleLight(device.node_id, (success: boolean, message: string) => {
      if (success) {
        const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
        console.log(chalk.green(`✓ ${displayName} toggled`));
      } else {
        console.error(chalk.red(`✗ Failed to toggle light: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerPower;
