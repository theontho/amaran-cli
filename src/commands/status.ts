import chalk from 'chalk';
import type { Command } from 'commander';

export interface CommandDeps {
  createController: (wsUrl?: string, clientId?: string, debug?: boolean) => Promise<any>;
  findDevice: (controller: any, deviceQuery: string) => any;
  asyncCommand: (fn: (...args: any[]) => Promise<any>) => any;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => any;
}

export function registerStatus(program: Command, deps: CommandDeps) {
  const { createController, findDevice, asyncCommand } = deps;

  program
    .command('status <device>')
    .description('Get the current status of a light')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .action(
      asyncCommand(async (deviceQuery: string, options: any) => {
        const controller = await createController(options.url, options.clientId, options.debug);

        const device = findDevice(controller, deviceQuery);
        if (!device) {
          console.error(chalk.red(`Device "${deviceQuery}" not found`));
          process.exit(1);
        }

        controller.getLightSleepStatus(
          device.node_id,
          (success: boolean, message: string, data?: any) => {
            if (success) {
              const nodeConfig = controller.getNode(device.node_id);
              const displayName =
                device.device_name || device.name || device.id || device.node_id || 'Unknown';
              console.log(chalk.blue(`Status for ${displayName}:`));
              console.log(`  State: ${data?.sleep ? chalk.red('Off') : chalk.green('On')}`);

              if (nodeConfig) {
                if (nodeConfig.intensity !== undefined) {
                  console.log(`  Intensity: ${nodeConfig.intensity}%`);
                }
                if (nodeConfig.cct !== undefined) {
                  console.log(`  Temperature: ${nodeConfig.cct}K`);
                }
                if (nodeConfig.hue !== undefined && nodeConfig.sat !== undefined) {
                  console.log(
                    `  HSI: H:${nodeConfig.hue} S:${nodeConfig.sat} I:${nodeConfig.intensity}`
                  );
                }
              }
            } else {
              console.error(chalk.red(`✗ Failed to get status: ${message}`));
            }
            controller.disconnect();
          }
        );
      })
    );
}

export default registerStatus;
