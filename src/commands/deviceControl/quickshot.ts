import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, requireBleController } from '../cmdUtils.js';

export function registerQuickshot(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const quickshot = program.command('quickshot').description('Manage quickshots');
  addStandardOptions(
    quickshot
      .command('update <id>')
      .option('--name <name>', 'New name')
      .description('Replace a local quickshot with current fixture states')
  ).action(
    asyncCommand(async (id: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) =>
              requireBleController(controller).updateSaved(
                'quickshots',
                id,
                typeof options.name === 'string' ? options.name : undefined,
                cb
              )
            ),
            null,
            2
          )
        );
      } finally {
        await controller.disconnect();
      }
    })
  );

  addStandardOptions(quickshot.command('list').description('List all available quickshots')).action(
    asyncCommand(handleQuickshotList(deps))
  );

  addStandardOptions(quickshot.command('set <id>').description('Apply a quickshot')).action(
    asyncCommand(handleQuickshotSet(deps))
  );
  for (const action of ['save', 'delete'] as const) {
    addStandardOptions(
      quickshot.command(`${action} <name-or-id>`).description(`${action} a local BLE quickshot`)
    ).action(
      asyncCommand(async (value: string, options: CommandOptions) => {
        const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
        try {
          const ble = requireBleController(controller);
          const result = await commandCallbackResult((callback) =>
            action === 'save' ? ble.saveQuickshot(value, callback) : ble.deleteSaved('quickshots', value, callback)
          );
          console.log(JSON.stringify(result, null, 2));
        } finally {
          await controller.disconnect();
        }
      })
    );
  }
}

function handleQuickshotList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    controller.getQuickshotList((success, message, data) => {
      if (success) {
        // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
        const quickshots = (data as { data: any[] }).data;
        if (quickshots.length === 0) {
          console.log(chalk.yellow('No quickshots found'));
        } else {
          console.log(chalk.blue('Quickshots:'));
          // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
          quickshots.forEach((qs: any, index: number) => {
            console.log(`${index + 1}. ${chalk.green(qs.name || 'Unnamed')} (${chalk.gray(qs.id || qs.quickshot_id)})`);
          });
        }
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error getting quickshot list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleQuickshotSet(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    controller.setQuickshot(id, (success, message) => {
      if (success) {
        console.log(chalk.green(`Quickshot ${id} applied successfully`));
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error applying quickshot: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerQuickshot;
