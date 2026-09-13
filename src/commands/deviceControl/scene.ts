import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, requireBleController } from '../cmdUtils.js';

export function registerScene(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const scene = program.command('scene').description('Manage scenes');

  addStandardOptions(scene.command('list').description('List all saved scenes')).action(
    asyncCommand(handleSceneList(deps))
  );
  addStandardOptions(scene.command('show <id>').description('Show every stored fixture, fan and effect state')).action(
    asyncCommand(async (id: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) => requireBleController(controller).getSaved('scenes', id, cb)),
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
    scene
      .command('save <name>')
      .option('--targets <keys>', 'Comma-separated fixture keys/group IDs; defaults to all')
      .description('Save current state as a scene')
  ).action(asyncCommand(handleSceneSave(deps)));

  addStandardOptions(
    scene
      .command('recall <id>')
      .option('--fade <seconds>', 'Crossfade to a steady local BLE scene')
      .description('Recall a saved scene')
  ).action(asyncCommand(handleSceneRecall(deps)));

  addStandardOptions(scene.command('delete <id>').description('Delete a scene')).action(
    asyncCommand(handleSceneDelete(deps))
  );

  addStandardOptions(
    scene
      .command('update <id>')
      .option('-n, --name <name>', 'New name for the scene')
      .option('--targets <keys>', 'Replace with these fixture keys/group IDs')
      .description('Update a scene')
  ).action(asyncCommand(handleSceneUpdate(deps)));
}

function handleSceneList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    controller.getSceneList((success, message, data) => {
      if (success) {
        // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
        const scenes = (data as { data: any[] }).data;
        if (scenes.length === 0) {
          console.log(chalk.yellow('No scenes found'));
        } else {
          console.log(chalk.blue('Saved Scenes:'));
          // biome-ignore lint/suspicious/noExplicitAny: API response data structure varies
          scenes.forEach((scene: any, index: number) => {
            console.log(
              `${index + 1}. ${chalk.green(scene.name || 'Unnamed')} (${chalk.gray(scene.id || scene.scene_id)})`
            );
          });
        }
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error getting scene list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleSceneSave(deps: CommandDeps) {
  const { createController } = deps;
  return async (name: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    if (options.targets !== undefined) {
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((callback) =>
              requireBleController(controller).saveSaved('scenes', name, targetList(options.targets), callback)
            ),
            null,
            2
          )
        );
      } finally {
        await controller.disconnect();
      }
      return;
    }
    controller.saveScene(name, (success, message, data) => {
      if (success) {
        console.log(chalk.green(`Scene "${name}" saved successfully`));
        if (data) console.log('Data:', data);
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error saving scene: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleSceneRecall(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);
    if (options.fade !== undefined) {
      try {
        await commandCallbackResult((cb) =>
          requireBleController(controller).transitionScene(id, Number(options.fade), cb)
        );
        console.log(chalk.green(`Scene ${id} transition complete`));
      } finally {
        await controller.disconnect();
      }
      return;
    }

    controller.recallScene(id, (success, message) => {
      if (success) {
        console.log(chalk.green(`Scene ${id} recalled successfully`));
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error recalling scene: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleSceneDelete(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    controller.deleteScene(id, (success, message) => {
      if (success) {
        console.log(chalk.green(`Scene ${id} deleted successfully`));
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error deleting scene: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleSceneUpdate(deps: CommandDeps) {
  const { createController } = deps;
  return async (id: string, options: CommandOptions & { name?: string }) => {
    const controller = await createController(options.url, options.clientId, options.debug, options.backend);

    if (options.targets !== undefined) {
      try {
        console.log(
          JSON.stringify(
            await commandCallbackResult((callback) =>
              requireBleController(controller).replaceSaved(
                'scenes',
                id,
                options.name,
                targetList(options.targets),
                callback
              )
            ),
            null,
            2
          )
        );
      } finally {
        await controller.disconnect();
      }
      return;
    }
    controller.updateScene(id, options.name, (success, message) => {
      if (success) {
        console.log(chalk.green(`Scene ${id} updated successfully`));
      } else {
        process.exitCode = 1;
        console.error(chalk.red(`Error updating scene: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function targetList(value: unknown): 'all' | string[] {
  if (String(value).trim().toLowerCase() === 'all') return 'all';
  const keys = String(value)
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) throw new Error('Targets must contain at least one fixture or group');
  return keys;
}

export default registerScene;
