import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions } from '../cmdUtils.js';

export function registerQuickshot(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const quickshot = program.command('quickshot').description('Manage quickshots');

  addStandardOptions(quickshot.command('list').description('List all available quickshots')).action(
    asyncCommand(handleQuickshotList(deps))
  );

  addStandardOptions(quickshot.command('set <id>').description('Apply a quickshot')).action(
    asyncCommand(handleQuickshotSet(deps))
  );
}

function handleQuickshotList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

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
        console.error(chalk.red(`Error getting quickshot list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleQuickshotSet(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.setQuickshot(id, (success, message) => {
      if (success) {
        console.log(chalk.green(`Quickshot ${id} applied successfully`));
      } else {
        console.error(chalk.red(`Error applying quickshot: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerQuickshot;
