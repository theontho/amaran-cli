import chalk from 'chalk';
import type { Command } from 'commander';
import { z } from 'zod';
import { numberInRange } from '../../ble/packets.js';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import {
  addStandardOptions,
  commandCallbackResult,
  getLightDevices,
  requireBleController,
  runDeviceAction,
} from '../cmdUtils.js';

export function registerEffect(program: Command, deps: CommandDeps) {
  const effect = program
    .command('effect')
    .description('Native lighting effects (flashing effects should be used cautiously)');
  addStandardOptions(
    effect
      .command('trigger <device>')
      .alias('retrigger')
      .description('Send one native trigger request; fixture event acknowledgement is unavailable')
  ).action(
    deps.asyncCommand(async (deviceQuery: string, options: CommandOptions) => {
      await runDeviceAction(
        { deps, options, deviceQuery, actionName: 'request effect trigger' },
        async (device, controller) => {
          await commandCallbackResult((cb) =>
            requireBleController(controller).triggerEffect(device.node_id as string, cb)
          );
        },
        async (controller) => {
          await commandCallbackResult((cb) =>
            requireBleController(controller).batch('all', 'effect-trigger', {}, false, cb)
          );
        }
      );
      console.log(
        'Trigger request sent; settings readback verified. Physical trigger event is not acknowledged by the fixture.'
      );
    })
  );
  addStandardOptions(effect.command('list').description('List native effects; availability varies by fixture')).action(
    deps.asyncCommand(async (options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, options.backend);
      try {
        console.log(
          JSON.stringify(await commandCallbackResult((callback) => controller.getSystemEffectList(callback)), null, 2)
        );
      } finally {
        await controller.disconnect();
      }
    })
  );
  addStandardOptions(
    effect
      .command('set <device> <effect_type>')
      .option('-i, --intensity <percent>', 'Brightness 0-100; omitted preserves current output')
  ).action(
    deps.asyncCommand(async (deviceQuery: string, name: string, options: CommandOptions) => {
      const intensity =
        options.intensity === undefined
          ? undefined
          : numberInRange(Number(options.intensity), 'brightness', 0, 100) * 10;
      await runDeviceAction(
        { deps, options, deviceQuery, actionName: `set ${name}` },
        async (device, controller) => {
          await commandCallbackResult((callback) =>
            controller.setSystemEffect(device.node_id as string, name, intensity, callback)
          );
        },
        async (controller) => {
          await commandCallbackResult((callback) => controller.setSystemEffectForAllLights(name, intensity, callback));
        }
      );
      console.log(chalk.green(`Effect ${name} set on ${deviceQuery}`));
    })
  );
  addStandardOptions(
    effect
      .command('custom <device> <effect_name>')
      .option(
        '--params <json>',
        'Effect parameters: brightness (percent), frequency, kelvin, gm, palette, hue, saturation',
        '{}'
      )
  ).action(
    deps.asyncCommand(async (deviceQuery: string, name: string, options: CommandOptions) => {
      const args = z.record(z.unknown()).parse(JSON.parse(String(options.params)));
      await runDeviceAction(
        { deps, options, deviceQuery, actionName: `set ${name}` },
        async (device, controller) => {
          await commandCallbackResult((callback) =>
            controller.setEffect(device.node_id as string, name, args, callback)
          );
        },
        async (controller) => {
          await commandCallbackResult((callback) =>
            requireBleController(controller).batch('all', 'effect', { ...args, name }, false, callback)
          );
        }
      );
      console.log(chalk.green(`Effect ${name} applied to ${deviceQuery}`));
    })
  );
  for (const control of ['speed', 'intensity', 'stop'] as const) {
    const command = effect
      .command(control === 'stop' ? 'stop <device>' : `${control} <device> <value>`)
      .description(
        control === 'stop'
          ? 'Restore pre-effect CCT/HSI, brightness and power (BLE)'
          : control === 'speed'
            ? 'Set native effect frequency (1-10)'
            : 'Set effect intensity (legacy API units 0-1000)'
      );
    const run = async (deviceQuery: string, value: string | undefined, options: CommandOptions) => {
      const number =
        control === 'stop'
          ? 0
          : numberInRange(Number(value), control, control === 'speed' ? 1 : 0, control === 'speed' ? 10 : 1000);
      const apply = async (id: string, controller: Parameters<typeof requireBleController>[0]) => {
        await commandCallbackResult((callback) =>
          control === 'stop'
            ? requireBleController(controller).stopEffect(id, callback)
            : control === 'speed'
              ? controller.setEffectSpeed(id, number, callback)
              : controller.setEffectIntensity(id, number, callback)
        );
      };
      await runDeviceAction(
        { deps, options, deviceQuery, actionName: `effect ${control}` },
        (device, controller) => apply(device.node_id as string, controller),
        async (controller) => {
          if (control === 'stop') {
            await commandCallbackResult((callback) =>
              requireBleController(controller).batch('all', 'effect-stop', {}, false, callback)
            );
            return;
          }
          for (const light of getLightDevices(controller.getDevices()))
            await apply(light.node_id as string, controller);
        }
      );
      console.log(chalk.green(`Effect ${control} applied to ${deviceQuery}`));
    };
    if (control === 'stop')
      addStandardOptions(command).action(
        deps.asyncCommand((device: string, options: CommandOptions) => run(device, undefined, options))
      );
    else addStandardOptions(command).action(deps.asyncCommand(run));
  }
}

export default registerEffect;
