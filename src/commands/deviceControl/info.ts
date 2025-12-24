import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device, NodeConfig } from '../../deviceControl/types.js';
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
        actionName: 'get device capabilities',
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          const nodeId = device.node_id as string;

          controller.getNodeConfig(nodeId, (success, message, data: unknown) => {
            if (success) {
              const displayName = device.device_name || device.name || 'Unknown';
              console.log(chalk.blue(`Capabilities for ${displayName} (${nodeId}):`));

              let config = data as NodeConfig;
              if (config && typeof config === 'object' && 'data' in config) {
                config = (config as { data: NodeConfig }).data;
              }

              if (config) {
                // Formatting helper for booleans
                const fmtBool = (val: unknown) => (val ? chalk.green('Yes') : chalk.red('No'));

                console.log(chalk.bold('\nLighting Support:'));
                console.log(`  CCT Support:        ${fmtBool(config.cct_support)}`);
                if (config.cct_support) {
                  console.log(`  CCT Range:          ${config.cct_min}K - ${config.cct_max}K`);
                }
                console.log(`  HSI Support:        ${fmtBool(config.hsi_support)}`);
                console.log(`  RGB Support:        ${fmtBool(config.rgb_support)}`);
                console.log(`  GM Support:         ${fmtBool(config.gm_support)}`);
                if (config.gm_support) {
                  console.log(`  GM Range:           ${config.gm_min} - ${config.gm_max}`);
                }

                console.log(chalk.bold('\nAdvanced Features:'));
                console.log(`  CCT Extension:      ${fmtBool(config.cct_extension_support)}`);
                if (config.cct_extension_support) {
                  console.log(`  CCT Ext Enabled:    ${fmtBool(config.cct_extension_enabled)}`);
                  console.log(`  CCT Ext Range:      ${config.cct_extension_min}K - ${config.cct_extension_max}K`);
                }
                console.log(`  Advanced HSI:       ${fmtBool(config.advanced_hsi_support)}`);
                console.log(`  GM v2 Support:      ${fmtBool(config.gm_v2_support)}`);
              } else {
                console.log(chalk.yellow('  No capability data returned.'));
              }
            } else {
              console.error(chalk.red(`✗ Failed to get device capabilities: ${message}`));
            }
            resolve();
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
