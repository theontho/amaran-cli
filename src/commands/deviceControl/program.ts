import { readFileSync, realpathSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { Command } from 'commander';
import { z } from 'zod';
import { MediaSourceSchema, mediaSamples } from '../../ble/media.js';
import type { CommandDeps, CommandOptions } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, requireBleController } from '../cmdUtils.js';

const Status = z
  .object({
    id: z.string(),
    state: z.enum(['preparing', 'running', 'restoring', 'completed', 'cancelled', 'failed']),
    error: z.string().optional(),
  })
  .passthrough();
const targets = (value: unknown) =>
  value === undefined || value === 'all'
    ? 'all'
    : String(value)
        .split(',')
        .map((key) => key.trim());

async function run(deps: CommandDeps, options: CommandOptions, body: Record<string, unknown>) {
  const source = body.source === undefined ? undefined : MediaSourceSchema.parse(body.source);
  const localSource = source && (source.kind === 'camera' || source.kind === 'microphone') ? source : undefined;
  if (localSource && options.background)
    throw new Error('Live camera/microphone capture stays with this CLI; use files or timelines for background jobs');
  const capture = new AbortController();
  const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
  const ble = requireBleController(controller);
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    capture.abort(new Error('CLI capture interrupted'));
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const request = localSource
      ? { ...body, source: { kind: 'samples', media: localSource.kind === 'camera' ? 'image' : 'audio' } }
      : body;
    let status = z
      .object({ data: Status })
      .parse(await commandCallbackResult((cb) => ble.startProgram(request, cb))).data;
    if (interrupted) {
      await commandCallbackResult((cb) => ble.stopProgram(status.id, cb));
      process.exitCode = 130;
      return;
    }
    if (options.background) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    if (localSource) {
      try {
        for await (const sample of mediaSamples(localSource, capture.signal)) {
          status = z
            .object({ data: Status })
            .parse(await commandCallbackResult((cb) => ble.getPrograms(status.id, cb))).data;
          if (!['preparing', 'running'].includes(status.state)) break;
          try {
            await commandCallbackResult((cb) => ble.programSample(status.id, sample, cb));
          } catch (error) {
            status = z
              .object({ data: Status })
              .parse(await commandCallbackResult((cb) => ble.getPrograms(status.id, cb))).data;
            if (!['preparing', 'running'].includes(status.state)) break;
            throw error;
          }
        }
      } catch (error) {
        if (!interrupted) {
          await commandCallbackResult((cb) => ble.stopProgram(status.id, cb));
          throw error;
        }
      }
    }
    while (['preparing', 'running', 'restoring'].includes(status.state)) {
      if (interrupted) {
        status = z
          .object({ data: Status })
          .parse(await commandCallbackResult((cb) => ble.stopProgram(status.id, cb))).data;
        break;
      }
      await delay(500);
      status = z
        .object({ data: Status })
        .parse(await commandCallbackResult((cb) => ble.getPrograms(status.id, cb))).data;
    }
    console.log(JSON.stringify(status, null, 2));
    if (status.state === 'failed') throw new Error(status.error ?? 'Program failed');
    if (status.state === 'cancelled') process.exitCode = interrupted ? 130 : 1;
  } finally {
    capture.abort(new Error('CLI capture ended'));
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await controller.disconnect();
  }
}

function common(command: Command): Command {
  if (!command.options.some((option) => option.long === '--targets'))
    command.option('--targets <keys>', 'Comma-separated fixture keys/group IDs or all');
  return addStandardOptions(
    command
      .option('--background', 'Return the daemon-owned job ID without waiting')
      .option('--no-restore', 'Keep final settings instead of restoring the initial state')
  );
}
export function registerPrograms(ble: Command, deps: CommandDeps) {
  common(
    ble.command('program <file>').description('Run a validated JSON lighting timeline; at most two cues per second')
  ).action(
    deps.asyncCommand(async (file: string, options: CommandOptions) => {
      const data = z.record(z.unknown()).parse(JSON.parse(readFileSync(file, 'utf8')));
      await run(deps, options, {
        ...data,
        kind: 'timeline',
        targets: options.targets === undefined ? (data.targets ?? 'all') : targets(options.targets),
        restore: options.restore === false ? false : (data.restore ?? true),
      });
    })
  );
  common(
    ble
      .command('audio <file>')
      .description('Drive brightness from a local audio file, without uploading audio')
      .option('--seconds <seconds>', 'Maximum run duration, 1-1200 seconds', '30')
      .option('--max <percent>', 'Maximum brightness', '100')
      .option('--gain <gain>', 'Audio sensitivity', '3')
  ).action(
    deps.asyncCommand(async (file: string, options: CommandOptions) => {
      await run(deps, options, {
        kind: 'audio',
        targets: targets(options.targets),
        source: { kind: 'audio-file', file: realpathSync(file) },
        duration: Number(options.seconds),
        maxBrightness: Number(options.max),
        gain: Number(options.gain),
        restore: options.restore,
      });
    })
  );
  common(
    ble
      .command('microphone [device]')
      .description('Explicitly capture local microphone audio to drive brightness; macOS permission required')
      .option('--seconds <seconds>', 'Maximum run duration, 1-1200 seconds', '30')
      .option('--max <percent>', 'Maximum brightness', '100')
      .option('--gain <gain>', 'Audio sensitivity', '3')
  ).action(
    deps.asyncCommand(async (device: string | undefined, options: CommandOptions) => {
      await run(deps, options, {
        kind: 'audio',
        targets: targets(options.targets),
        source: { kind: 'microphone', device: Number(device ?? 0) },
        duration: Number(options.seconds),
        maxBrightness: Number(options.max),
        gain: Number(options.gain),
        restore: options.restore,
      });
    })
  );
  common(
    ble
      .command('picker')
      .description('Drive HSI from a local image or live camera; no images are uploaded')
      .requiredOption('--targets <keys>', 'HSI-capable fixture keys/group IDs')
      .option('--image <file>', 'Use a local image instead of the camera')
      .option('--camera <index>', 'Live camera index (default 0)')
      .option('--region <x,y,width,height>', 'Optional pixel crop')
      .option('--seconds <seconds>', 'Maximum run duration, 1-1200 seconds', '30')
      .option('--max <percent>', 'Output brightness', '100')
  ).action(
    deps.asyncCommand(async (options: CommandOptions) => {
      if (options.image && options.camera) throw new Error('Choose an image or a camera, not both');
      let region: { x: number; y: number; width: number; height: number } | undefined;
      if (options.region !== undefined) {
        const values = String(options.region)
          .split(',')
          .map((value) => value.trim());
        if (values.length !== 4 || values.some((value) => !/^\d+$/.test(value)))
          throw new Error('Region must be x,y,width,height integers');
        const [x, y, width, height] = values.map(Number);
        region = { x, y, width, height };
      }
      const source = options.image
        ? { kind: 'image-file', file: realpathSync(String(options.image)), region }
        : { kind: 'camera', device: Number(options.camera ?? 0), region };
      await run(deps, options, {
        kind: 'picker',
        targets: targets(options.targets),
        source,
        duration: Number(options.seconds),
        maxBrightness: Number(options.max),
        restore: options.restore,
      });
    })
  );
  addStandardOptions(
    ble.command('jobs <action> [id]').description('List, inspect or stop a running lighting program')
  ).action(
    deps.asyncCommand(async (action: string, id: string | undefined, options: CommandOptions) => {
      if (!['list', 'status', 'stop'].includes(action) || (action !== 'list' && !id))
        throw new Error('Use jobs list, jobs status ID, or jobs stop ID');
      const controller = await deps.createController(options.url, options.clientId, options.debug, 'ble');
      try {
        const api = requireBleController(controller);
        console.log(
          JSON.stringify(
            await commandCallbackResult((cb) =>
              action === 'stop'
                ? api.stopProgram(id ?? '', cb)
                : api.getPrograms(action === 'list' ? undefined : id, cb)
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
}
