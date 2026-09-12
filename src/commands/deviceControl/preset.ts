import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, requireBleController, runDeviceAction } from '../cmdUtils.js';

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
  addStandardOptions(
    preset.command('save <device> <name>').description('Save a single-fixture local BLE preset')
  ).action(
    asyncCommand(async (deviceQuery: string, name: string, options: CommandOptions) => {
      await runDeviceAction(
        { deps, options, deviceQuery, actionName: 'save preset' },
        async (device, controller) => {
          console.log(
            JSON.stringify(
              await commandCallbackResult((callback) =>
                requireBleController(controller).savePreset(device.node_id as string, name, callback)
              ),
              null,
              2
            )
          );
        },
        async () => {
          throw new Error('A preset stores one fixture; use scene save for all lights');
        }
      );
    })
  );
  addStandardOptions(preset.command('delete <id>').description('Delete a local BLE preset')).action(
    asyncCommand(async (id: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        await commandCallbackResult((callback) =>
          requireBleController(controller).deleteSaved('presets', id, callback)
        );
        console.log(`Preset ${id} deleted`);
      } finally {
        await controller.disconnect();
      }
    })
  );
}

function handlePresetList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    controller.getPresetList((success, message, data) => {
      if (success) {
        // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
        const presets = (data as { data: any }).data;
        console.log(chalk.blue('Available Presets:'));
        console.log(JSON.stringify(presets, null, 2));
      } else {
        process.exitCode = 1;
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
              process.exitCode = 1;
              console.error(chalk.red(`✗ Failed to recall preset: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        throw new Error('Preset recall for "all" is not supported; use a saved scene');
      }
    );
  };
}

export default registerPreset;
