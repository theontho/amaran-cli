import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions } from '../cmdUtils.js';

export function registerGroup(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const group = program.command('group').description('Manage device groups');

  addStandardOptions(group.command('list').description('List all groups')).action(asyncCommand(handleGroupList(deps)));

  addStandardOptions(group.command('create <name>').description('Create a new group')).action(
    asyncCommand(handleGroupCreate(deps))
  );

  addStandardOptions(group.command('delete <id>').description('Delete a group')).action(
    asyncCommand(handleGroupDelete(deps))
  );

  addStandardOptions(group.command('add <group_id> <node_id>').description('Add a device to a group')).action(
    asyncCommand(handleGroupAdd(deps))
  );

  addStandardOptions(group.command('remove <group_id> <node_id>').description('Remove a device from a group')).action(
    asyncCommand(handleGroupRemove(deps))
  );
}

function handleGroupList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.getGroupList((success, message, data) => {
      if (success) {
        // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
        const groups = (data as { data: any[] }).data;
        if (groups.length === 0) {
          console.log(chalk.yellow('No groups found'));
        } else {
          console.log(chalk.blue('Groups:'));
          // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
          groups.forEach((group: any, index: number) => {
            console.log(
              `${index + 1}. ${chalk.green(group.name || 'Unnamed')} (${chalk.gray(group.id || group.group_id)})`
            );
          });
        }
      } else {
        console.error(chalk.red(`Error getting group list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleGroupCreate(deps: CommandDeps) {
  const { createController } = deps;
  return async (name: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.createGroup(name, (success, message, data) => {
      if (success) {
        console.log(chalk.green(`Group "${name}" created successfully`));
        if (data) console.log('Data:', data);
      } else {
        console.error(chalk.red(`Error creating group: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleGroupDelete(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.deleteGroup(id, (success, message) => {
      if (success) {
        console.log(chalk.green(`Group ${id} deleted successfully`));
      } else {
        console.error(chalk.red(`Error deleting group: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleGroupAdd(deps: CommandDeps) {
  const { createController } = deps;
  return async (groupId: string, nodeId: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.addToGroup(groupId, nodeId, (success, message) => {
      if (success) {
        console.log(chalk.green(`Device ${nodeId} added to group ${groupId}`));
      } else {
        console.error(chalk.red(`Error adding device to group: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleGroupRemove(deps: CommandDeps) {
  const { createController } = deps;
  return async (groupId: string, nodeId: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.removeFromGroup(groupId, nodeId, (success, message) => {
      if (success) {
        console.log(chalk.green(`Device ${nodeId} removed from group ${groupId}`));
      } else {
        console.error(chalk.red(`Error removing device from group: ${message}`));
      }
      controller.disconnect();
    });
  };
}

export default registerGroup;
