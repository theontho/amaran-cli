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
      .option('--targets <keys>', 'Replace with these fixture keys/group IDs')
      .description('Replace a local quickshot with current fixture states')
  ).action(
    asyncCommand(async (id: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) => {
              const ble = requireBleController(controller);
              return options.targets === undefined
                ? ble.updateSaved('quickshots', id, typeof options.name === 'string' ? options.name : undefined, cb)
                : ble.replaceSaved(
                    'quickshots',
                    id,
                    typeof options.name === 'string' ? options.name : undefined,
                    targetList(options.targets),
                    cb
                  );
            }),
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
  addStandardOptions(
    quickshot.command('show <id>').description('Show every stored fixture, fan and effect state')
  ).action(
    asyncCommand(async (id: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) => requireBleController(controller).getSaved('quickshots', id, cb)),
            null,
            2
          )
        );
      } finally {
        await controller.disconnect();
      }
    })
  );

  addStandardOptions(
    quickshot
      .command('set <id>')
      .option('--fade <seconds>', 'Transition to a steady quickshot over 0.5-20 seconds')
      .description('Apply a quickshot')
  ).action(asyncCommand(handleQuickshotSet(deps)));
  for (const action of ['save', 'delete'] as const) {
    const command = quickshot.command(`${action} <name-or-id>`).description(`${action} a local BLE quickshot`);
    if (action === 'save')
      command.option('--targets <keys>', 'Comma-separated fixture keys/group IDs; defaults to all');
    addStandardOptions(command).action(
      asyncCommand(async (value: string, options: CommandOptions) => {
        const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
        try {
          const ble = requireBleController(controller);
          const result = await commandCallbackResult((callback) =>
            action === 'save'
              ? ble.saveSaved('quickshots', value, targetList(options.targets), callback)
              : ble.deleteSaved('quickshots', value, callback)
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
    try {
      await commandCallbackResult((callback) =>
        options.fade === undefined
          ? controller.setQuickshot(id, callback)
          : requireBleController(controller).recallSaved('quickshots', id, { seconds: Number(options.fade) }, callback)
      );
      console.log(
        chalk.green(`Quickshot ${id} ${options.fade === undefined ? 'applied' : 'transitioned'} successfully`)
      );
    } finally {
      await controller.disconnect();
    }
  };
}

function targetList(value: unknown): 'all' | string[] | undefined {
  if (value === undefined) return undefined;
  if (String(value).trim().toLowerCase() === 'all') return 'all';
  const keys = String(value)
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) throw new Error('Targets must contain at least one fixture or group');
  return keys;
}

export default registerQuickshot;
