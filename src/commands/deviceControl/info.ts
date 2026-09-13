import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device, NodeConfig } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerInfo(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const info = program.command('info [device]').description('Get detailed device info');

  addStandardOptions(info).action(asyncCommand(handleDeviceInfo(deps)));
}

function handleDeviceInfo(deps: CommandDeps) {
  return async (deviceQuery: string | undefined, options: CommandOptions) => {
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
              displayConfig(device, data, options);
            } else {
              console.error(
                chalk.red(`✗ Failed to get device capabilities for ${device.name || device.node_id}: ${message}`)
              );
            }
            resolve();
          });
        });
      },
      async (controller) => {
        const devices = controller.getDevices();
        if (devices.length === 0) {
          console.log(chalk.yellow('No devices found.'));
          return;
        }

        for (const device of devices) {
          await new Promise<void>((resolve) => {
            const nodeId = device.node_id as string;
            controller.getNodeConfig(nodeId, (success, message, data: unknown) => {
              if (success) {
                displayConfig(device, data, options);
                console.log(''); // Add a newline between devices
              } else {
                console.error(
                  chalk.red(`✗ Failed to get device capabilities for ${device.name || device.node_id}: ${message}`)
                );
              }
              resolve();
            });
          });
        }
      }
    );
  };
}

function displayConfig(device: Device, data: unknown, _options: CommandOptions) {
  const nodeId = device.node_id as string;
  const displayName = device.device_name || device.name || 'Unknown';
  console.log(chalk.blue(`Capabilities for ${displayName} (${nodeId}):`));

  let config = data as NodeConfig;
  if (config && typeof config === 'object' && 'data' in config) {
    config = (config as { data: NodeConfig }).data;
  }

  // Normalize CCT range keys from Amaran API if needed
  if (config && typeof config === 'object') {
    if (config.product_cct_min !== undefined && config.cct_min === undefined) {
      config.cct_min = config.product_cct_min;
    }
    if (config.product_cct_max !== undefined && config.cct_max === undefined) {
      config.cct_max = config.product_cct_max;
    }
  }

  if (config) {
    // Formatting helper for booleans
    const fmtBool = (val: unknown) => (val ? chalk.green('Yes') : chalk.red('No'));

    console.log(chalk.bold('\nLighting Support:'));
    const cctRange = config.cct_support ? ` (${config.cct_min}K - ${config.cct_max}K)` : '';
    console.log(`  Correlated Color Temperature (CCT): ${fmtBool(config.cct_support)}${cctRange}`);

    console.log(`  Hue, Saturation, Intensity (HSI):   ${fmtBool(config.hsi_support)}`);
    console.log(`  Red, Green, Blue (RGB):             ${fmtBool(config.rgb_support)}`);

    const gmRange = config.gm_support ? ` (${config.gm_min} - ${config.gm_max})` : '';
    console.log(`  Green-Magenta (GM):                 ${fmtBool(config.gm_support)}${gmRange}`);

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
}

export default registerInfo;
