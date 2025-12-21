import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerPreset(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const preset = program.command('preset').description('Manage and recall presets');

  addStandardOptions(preset.command('list').description('List all available presets')).action(
    asyncCommand(handlePresetList(deps))
  );

  addStandardOptions(preset.command('recall <device> <preset_id>').description('Recall a preset on a device')).action(
    asyncCommand(handlePresetRecall(deps))
  );

  addStandardOptions(
    preset.command('set <device> <preset_id>').description('Set a preset on a device (alias for recall)')
  ).action(asyncCommand(handlePresetRecall(deps)));
}

function handlePresetList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.getPresetList((success, message, data) => {
      if (success) {
        // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
        const presets = (data as { data: any }).data;
        console.log(chalk.blue('Available Presets:'));
        console.log(JSON.stringify(presets, null, 2));
      } else {
        console.error(chalk.red(`Error getting preset list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handlePresetRecall(deps: CommandDeps) {
  return async (deviceQuery: string, presetId: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `recall preset ${presetId}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          const nodeId = device.node_id as string;
          controller.recallPreset(nodeId, presetId, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Preset ${presetId} recalled on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to recall preset: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Preset recall for "all" is not supported.'));
        return Promise.resolve();
      }
    );
  };
}

export default registerPreset;
