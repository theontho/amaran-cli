import type { Command } from 'commander';
import { z } from 'zod';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, requireBleController, runDeviceAction } from '../cmdUtils.js';

export default function registerBle(program: Command, deps: CommandDeps): void {
  const { asyncCommand } = deps;
  const ble = program.command('ble').description('Direct Bluetooth Mesh setup and verified local daemon');
  addStandardOptions(
    ble
      .command('transition <action> <seconds>')
      .description('Fade CCT, HSI or brightness; cross-mode fades pass through zero output')
      .option('--targets <keys>', 'Comma-separated fixture keys/group IDs or all', 'all')
      .option('--args <json>', 'Target settings (same arguments as the corresponding BLE action)', '{}')
  ).action(
    asyncCommand(async (action: string, seconds: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
      try {
        const targets =
          options.targets === 'all'
            ? 'all'
            : String(options.targets)
                .split(',')
                .map((key) => key.trim());
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) =>
              requireBleController(controller).transition(
                targets,
                action,
                z.record(z.unknown()).parse(JSON.parse(String(options.args))),
                Number(seconds),
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
  addStandardOptions(
    ble
      .command('override <action>')
      .description('Hold, resume or inspect circadian control for selected fixtures')
      .option('--targets <keys>', 'Comma-separated fixture keys/group IDs or all', 'all')
      .option('--minutes <minutes>', 'Manual hold duration, 1-1440 minutes', '30')
  ).action(
    asyncCommand(async (action: string, options: CommandOptions) => {
      if (!['hold', 'resume', 'status'].includes(action))
        throw new Error('Override action must be hold, resume or status');
      const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
      try {
        const targets =
          options.targets === 'all'
            ? 'all'
            : String(options.targets)
                .split(',')
                .map((key) => key.trim());
        const minutes = action === 'status' ? undefined : action === 'resume' ? 0 : Number(options.minutes);
        if (action === 'hold' && (minutes === undefined || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440))
          throw new Error('Hold duration must be between 1 and 1440 minutes');
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) => requireBleController(controller).overrides(targets, minutes, cb)),
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
    ble
      .command('info [device]')
      .description('Read native firmware/protocol identifiers and reported product capabilities')
  ).action(
    asyncCommand(async (deviceQuery: string | undefined, options: CommandOptions) => {
      await runDeviceAction(
        { deps, options: { ...options, backend: 'ble' }, deviceQuery, actionName: 'read product information' },
        async (device, controller) => {
          console.log(
            JSON.stringify(
              await commandCallbackResult((cb) =>
                requireBleController(controller).getProductInfo(device.node_id as string, cb)
              ),
              null,
              2
            )
          );
        },
        async (controller) => {
          for (const device of controller.getDevices().filter((item) => item.device_type === 'ble-light'))
            console.log(
              device.node_id,
              JSON.stringify(
                await commandCallbackResult((cb) =>
                  requireBleController(controller).getProductInfo(device.node_id as string, cb)
                ),
                null,
                2
              )
            );
        }
      );
    })
  );
  addStandardOptions(
    ble.command('gm <device> <value>').description('150c CCT tint: -100 magenta to +100 green, steps of 10')
  ).action(
    asyncCommand(async (deviceQuery: string, value: string, options: CommandOptions) => {
      await runDeviceAction(
        { deps, options: { ...options, backend: 'ble' }, deviceQuery, actionName: 'adjust G/M' },
        async (device, controller) => {
          console.log(
            JSON.stringify(
              await commandCallbackResult((callback) =>
                requireBleController(controller).setGM(device.node_id as string, Number(value), callback)
              ),
              null,
              2
            )
          );
        },
        async () => {
          throw new Error('Select the 150c; the 200x S fixtures do not support G/M');
        }
      );
    })
  );
  addStandardOptions(
    ble
      .command('batch <action>')
      .description('Prevalidated group control; explicit broadcast reaches the entire provisioned mesh')
      .option('--targets <keys>', 'Comma-separated fixture keys or all', 'all')
      .option('--args <json>', 'Action arguments; brightness is percent', '{}')
      .option('--broadcast', 'Use mesh-wide broadcast instead of burst unicast')
  ).action(
    asyncCommand(async (action: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
      try {
        const targets =
          String(options.targets) === 'all'
            ? 'all'
            : String(options.targets)
                .split(',')
                .map((key) => key.trim());
        const args = z.record(z.unknown()).parse(JSON.parse(String(options.args)));
        console.log(
          JSON.stringify(
            await commandCallbackResult((callback) =>
              requireBleController(controller).batch(targets, action, args, options.broadcast === true, callback)
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
  addStandardOptions(
    ble
      .command('fade <brightness> <seconds>')
      .description('Host-paced 0.5-20s brightness fade; preserves power state and verifies endpoints')
      .option('--targets <keys>', 'Comma-separated fixture keys or all', 'all')
  ).action(
    asyncCommand(async (brightness: string, seconds: string, options: CommandOptions) => {
      const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
      try {
        const targets =
          String(options.targets) === 'all'
            ? 'all'
            : String(options.targets)
                .split(',')
                .map((key) => key.trim());
        console.log(
          JSON.stringify(
            await commandCallbackResult((callback) =>
              requireBleController(controller).fade(targets, Number(brightness), Number(seconds), callback)
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
  ble
    .command('service <action>')
    .description('Manage the macOS user daemon: install, start, stop or status')
    .action(
      asyncCommand(async (action: string) => {
        const { manageBleService } = await import('../../ble/service.js');
        await manageBleService(action);
      })
    );
  ble
    .command('import <config>')
    .description('Import a private lights.json from the previous BLE project (once)')
    .option('--source <address>', 'Dedicated unused controller unicast address (never the desktop source)', '32766')
    .action(
      asyncCommand(async (config: string, options: { source: string }) => {
        const { importMesh } = await import('../../ble/setup.js');
        importMesh(config, Number(options.source));
      })
    );
  ble
    .command('serve')
    .description('Run a foreground, loopback-only BLE daemon; quit Amaran Desktop first')
    .option('--port <port>', 'Local HTTP port', '2708')
    .option('-d, --debug', 'Log authenticated protocol traffic (no mesh keys)')
    .action(
      asyncCommand(async (options: { port: string; debug?: boolean }) => {
        const port = Number(options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error('Port must be an integer from 1 to 65535');
        const { serveBle } = await import('../../ble/daemon.js');
        await serveBle(port, options.debug);
      })
    );
}
