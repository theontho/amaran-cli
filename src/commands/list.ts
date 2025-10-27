import chalk from 'chalk';
import type { Command } from 'commander';

export interface CommandDeps {
  createController: (wsUrl?: string, clientId?: string, debug?: boolean) => Promise<any>;
  findDevice: (controller: any, deviceQuery: string) => any;
  asyncCommand: (fn: (...args: any[]) => Promise<any>) => any;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => any;
}

export function registerList(program: Command, deps: CommandDeps) {
  const { createController, asyncCommand } = deps;

  program
    .command('list')
    .alias('ls')
    .description('List all available lights')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(
      asyncCommand(async (options: any) => {
        const controller = await createController(options.url, options.clientId, options.debug);

        const devices = controller.getDevices();

        if (devices.length === 0) {
          console.log(chalk.yellow('No devices found'));
          return;
        }

        console.log(chalk.blue('Available lights:'));
        devices.forEach((device: any, index: number) => {
          const displayName =
            device.device_name || device.name || device.id || device.node_id || 'Unknown';
          console.log(
            `${index + 1}. ${chalk.green(displayName)} (${chalk.gray(device.node_id || device.id || '?')})`
          );
          if (device.device_type) {
            console.log(`   Type: ${device.device_type}`);
          }
        });

        await controller.disconnect();
      })
    );
}

export default registerList;
