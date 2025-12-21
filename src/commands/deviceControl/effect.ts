import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import { addStandardOptions, runDeviceAction } from '../cmdUtils.js';

export function registerEffect(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;
  const effect = program.command('effect').description('Control effects');

  addStandardOptions(effect.command('list').description('List available system effects')).action(
    asyncCommand(handleEffectList(deps))
  );

  addStandardOptions(
    effect
      .command('set <device> <effect_type>')
      .option('-i, --intensity <percent>', 'Intensity percentage')
      .description('Set a system effect')
  ).action(asyncCommand(handleEffectSet(deps)));

  addStandardOptions(effect.command('custom <device> <effect_name>').description('Set a custom effect by name')).action(
    asyncCommand(handleEffectCustom(deps))
  );

  addStandardOptions(effect.command('speed <device> <speed>').description('Set effect speed')).action(
    asyncCommand(handleEffectSpeed(deps))
  );

  addStandardOptions(effect.command('intensity <device> <intensity>').description('Set effect intensity')).action(
    asyncCommand(handleEffectIntensity(deps))
  );
}

function handleEffectList(deps: CommandDeps) {
  const { createController } = deps;
  return async (options: CommandOptions) => {
    const controller = await createController(options.url, options.clientId, options.debug);

    controller.getSystemEffectList((success, message, data) => {
      if (success) {
        const effects = (data as { data: string[] }).data;
        console.log(chalk.blue('System Effects:'));
        effects.forEach((eff) => {
          console.log(`  - ${eff}`);
        });
      } else {
        console.error(chalk.red(`Error getting effect list: ${message}`));
      }
      controller.disconnect();
    });
  };
}

function handleEffectSet(deps: CommandDeps) {
  return async (deviceQuery: string, effectType: string, options: CommandOptions & { intensity?: string }) => {
    let intensity: number | undefined;
    if (options.intensity) {
      const p = parseFloat(options.intensity);
      if (!Number.isNaN(p)) {
        intensity = p * 10; // Convert to API scale
      }
    }

    // Special handling for "all" devices
    if (deviceQuery.toLowerCase() === 'all') {
      const { createController } = deps;
      const controller = await createController(options.url, options.clientId, options.debug);
      try {
        await controller.setSystemEffectForAllLights(effectType, intensity, (success, message) => {
          if (!success) {
            console.error(chalk.red(`Error setting effect for all lights: ${message}`));
          }
        });
        console.log(chalk.green(`Effect ${effectType} set for all lights`));
      } finally {
        await controller.disconnect();
      }
      return;
    }

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set effect ${effectType}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setSystemEffect(device.node_id as string, effectType, intensity, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Effect ${effectType} set on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set effect: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk effect set not supported.'));
        return Promise.resolve();
      }
    );
  };
}

function handleEffectCustom(deps: CommandDeps) {
  return async (deviceQuery: string, effectName: string, options: CommandOptions) => {
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set custom effect ${effectName}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setEffect(device.node_id as string, effectName, {}, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Custom effect ${effectName} set on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set custom effect: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk custom effect not supported.'));
        return Promise.resolve();
      }
    );
  };
}

function handleEffectSpeed(deps: CommandDeps) {
  return async (deviceQuery: string, speedStr: string, options: CommandOptions) => {
    const speed = parseInt(speedStr, 10);
    if (Number.isNaN(speed)) {
      console.error(chalk.red('Speed must be a number'));
      return;
    }

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set effect speed to ${speed}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setEffectSpeed(device.node_id as string, speed, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Effect speed set to ${speed} on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set effect speed: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk effect speed not supported.'));
        return Promise.resolve();
      }
    );
  };
}

function handleEffectIntensity(deps: CommandDeps) {
  return async (deviceQuery: string, valueStr: string, options: CommandOptions) => {
    const value = parseInt(valueStr, 10);
    if (Number.isNaN(value)) {
      console.error(chalk.red('Intensity must be a number'));
      return;
    }

    // Note: The API usually expects 0-1000 range or similar. Check constants.
    // Assuming user inputs API value directly for this low-level command,
    // or we could map from percent. Let's assume input matches API expectation for now.

    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: `set effect intensity to ${value}`,
      },
      (device: Device, controller) => {
        return new Promise((resolve) => {
          controller.setEffectIntensity(device.node_id as string, value, (success, message) => {
            if (success) {
              console.log(chalk.green(`✓ Effect intensity set to ${value} on ${device.device_name || 'device'}`));
            } else {
              console.error(chalk.red(`✗ Failed to set effect intensity: ${message}`));
            }
            resolve();
          });
        });
      },
      () => {
        console.log(chalk.yellow('Bulk effect intensity not supported.'));
        return Promise.resolve();
      }
    );
  };
}

export default registerEffect;
