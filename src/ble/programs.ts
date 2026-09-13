import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { type VerifiedController, validateAction } from './controller.js';
import { type MediaSample, MediaSampleSchema, MediaSourceSchema, mediaCommand, mediaSamples } from './media.js';
import type { FixtureState } from './telink.js';

export const ProgramSchema = z
  .object({
    kind: z.enum(['timeline', 'audio', 'picker']),
    targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
    duration: z.number().min(1).max(1200).default(30),
    restore: z.boolean().default(true),
    maxBrightness: z.number().min(0).max(100).default(100),
    gain: z.number().positive().max(100).default(3),
    source: MediaSourceSchema.optional(),
    steps: z
      .array(
        z
          .object({
            at: z.number().min(0).max(1200),
            action: z.enum(['cct', 'hsi', 'brightness', 'color', 'gm', 'on', 'off', 'effect', 'effect-stop']),
            args: z.record(z.unknown()),
          })
          .strict()
      )
      .min(1)
      .max(512)
      .optional(),
  })
  .strict()
  .superRefine((program, context) => {
    if (program.kind === 'timeline') {
      if (!program.steps || program.source)
        context.addIssue({ code: 'custom', message: 'A timeline needs steps and no media source' });
      program.steps?.forEach((step, index) => {
        if (step.at > program.duration || (index && step.at - (program.steps?.[index - 1].at ?? 0) < 0.5))
          context.addIssue({
            code: 'custom',
            message: 'Steps must be ordered, at least 0.5 seconds apart, and within duration',
          });
      });
    } else {
      if (program.steps || !program.source)
        context.addIssue({ code: 'custom', message: 'Media programs need a source and no timeline steps' });
      if (
        program.source &&
        (program.kind === 'audio') !==
          (program.source.kind === 'samples'
            ? program.source.media === 'audio'
            : ['audio-file', 'microphone'].includes(program.source.kind))
      )
        context.addIssue({ code: 'custom', message: 'Media source does not match program kind' });
    }
  });
export type Program = z.infer<typeof ProgramSchema>;
export interface ProgramStatus {
  id: string;
  kind: Program['kind'];
  targets: string[];
  state: 'preparing' | 'running' | 'restoring' | 'completed' | 'cancelled' | 'failed';
  startedAt: string;
  frames: number;
  error?: string;
  lastSample?: MediaSample;
}
interface Running {
  status: ProgramStatus;
  program: Program;
  cancel: AbortController;
  restore: boolean;
  changed: boolean;
  done: Promise<void>;
  latest?: MediaSample;
  wake?: () => void;
}

export class Programs {
  private readonly jobs = new Map<string, Running>();
  private closed = false;
  private starts: Promise<void> = Promise.resolve();
  private readonly generations = new Map<string, number>();
  constructor(
    private readonly controller: Pick<
      VerifiedController,
      'config' | 'snapshot' | 'override' | 'overrideStatus' | 'reserveControl' | 'batch' | 'restore'
    >,
    private readonly targets: (targets: Program['targets']) => string[]
  ) {}

  list(): ProgramStatus[] {
    return [...this.jobs.values()].map((job) => structuredClone(job.status));
  }
  get(id: string): ProgramStatus {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown program ${id}`);
    return structuredClone(job.status);
  }
  async start(value: unknown): Promise<ProgramStatus> {
    if (this.closed) throw new Error('Program manager is stopping');
    const program = ProgramSchema.parse(value);
    const keys = this.targets(program.targets);
    if (!keys.length) throw new Error('Program has no targets');
    for (const key of keys) {
      const light = this.controller.config.lights.find((item) => item.key === key);
      if (!light) throw new Error(`Unknown fixture ${key}`);
      if (program.kind === 'timeline')
        for (const step of program.steps ?? []) validateAction(light, step.action, step.args);
      else
        validateAction(
          light,
          program.kind === 'picker' ? 'hsi' : 'brightness',
          program.kind === 'picker'
            ? { hue: 0, saturation: 100, brightness: program.maxBrightness }
            : { value: program.maxBrightness }
        );
    }
    if (program.source && program.source.kind !== 'samples') mediaCommand(program.source);
    const generations = keys.map((key) => {
      const value = (this.generations.get(key) ?? 0) + 1;
      this.generations.set(key, value);
      return value;
    });
    const previous = this.starts;
    let release: () => void = () => undefined;
    this.starts = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const superseded = () => keys.some((key, index) => this.generations.get(key) !== generations[index]);
      if (superseded()) throw new Error('Program start superseded by newer control');
      await this.cancelExisting(keys);
      if (superseded()) throw new Error('Program start superseded by newer control');
      if (this.closed) throw new Error('Program manager is stopping');
      const active = [...this.jobs.values()].filter((job) =>
        ['running', 'preparing', 'restoring'].includes(job.status.state)
      );
      if (active.length >= 4) throw new Error('Too many active programs');
      for (const [id, job] of this.jobs)
        if (this.jobs.size >= 50 && !['running', 'preparing', 'restoring'].includes(job.status.state))
          this.jobs.delete(id);
      const job: Running = {
        status: {
          id: randomUUID(),
          kind: program.kind,
          targets: keys,
          state: 'preparing',
          startedAt: new Date().toISOString(),
          frames: 0,
        },
        program,
        cancel: new AbortController(),
        restore: program.restore,
        changed: false,
        done: Promise.resolve(),
      };
      this.jobs.set(job.status.id, job);
      job.done = this.run(job);
      return structuredClone(job.status);
    } finally {
      release();
    }
  }
  async cancelTargets(keys: string[]): Promise<void> {
    for (const key of keys) this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    await this.cancelExisting(keys);
  }
  private async cancelExisting(keys: string[]): Promise<void> {
    const targets = new Set(keys);
    const jobs = [...this.jobs.values()].filter(
      (job) =>
        ['running', 'preparing', 'restoring'].includes(job.status.state) &&
        job.status.targets.some((key) => targets.has(key))
    );
    for (const job of jobs) {
      job.restore = false;
      job.cancel.abort(new Error('Manual control or another program took over'));
    }
    await Promise.all(jobs.map((job) => job.done));
  }
  async stop(id: string): Promise<ProgramStatus> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown program ${id}`);
    job.cancel.abort(new Error('Program stopped'));
    await job.done;
    return structuredClone(job.status);
  }
  sample(id: string, value: unknown): void {
    const job = this.jobs.get(id);
    if (
      !job ||
      job.program.source?.kind !== 'samples' ||
      !['preparing', 'running'].includes(job.status.state) ||
      job.cancel.signal.aborted
    )
      throw new Error('Program is not accepting live samples');
    const sample = MediaSampleSchema.parse(value);
    if ('rms' in sample !== (job.program.kind === 'audio')) throw new Error('Sample does not match the program kind');
    job.latest = sample;
    job.wake?.();
  }
  private async *inputSamples(job: Running, signal: AbortSignal): AsyncGenerator<MediaSample> {
    while (true) {
      signal.throwIfAborted();
      if (job.latest) {
        const sample = job.latest;
        job.latest = undefined;
        yield sample;
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          job.wake = undefined;
          signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          cleanup();
          reject(signal.reason instanceof Error ? signal.reason : new Error('Sample stream cancelled'));
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('No live samples received for 10 seconds'));
        }, 10_000);
        job.wake = () => {
          cleanup();
          resolve();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) {
      job.restore = false;
      job.cancel.abort(new Error('Daemon stopped'));
    }
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }
  private async command(job: Running, action: string, args: Record<string, unknown>) {
    job.cancel.signal.throwIfAborted();
    job.changed = true;
    await this.controller.batch(job.status.targets, action, args, false, job.cancel.signal);
    job.status.frames++;
  }
  private async run(job: Running): Promise<void> {
    const { program, cancel } = job;
    let before: Record<string, FixtureState> | undefined;
    let prior: Record<string, number> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    try {
      before = await this.controller.snapshot(job.status.targets);
      cancel.signal.throwIfAborted();
      const remaining = this.controller.overrideStatus(job.status.targets);
      prior = Object.fromEntries(Object.entries(remaining).map(([key, ms]) => [key, ms ? Date.now() + ms : 0]));
      if (program.kind !== 'timeline' && Object.values(before).some((state) => state.sleep || state.mode === 'effect'))
        throw new Error('Start media control with awake fixtures in steady CCT or HSI mode');
      await this.controller.reserveControl(job.status.targets, Math.max(30, program.duration / 60 + 1), cancel.signal);
      held = true;
      job.status.state = 'running';
      const started = Date.now();
      if (program.kind === 'timeline') {
        for (const step of program.steps ?? []) {
          await delay(Math.max(0, started + step.at * 1000 - Date.now()), undefined, { signal: cancel.signal });
          await this.command(job, step.action, step.args);
        }
        await delay(Math.max(0, started + program.duration * 1000 - Date.now()), undefined, { signal: cancel.signal });
      } else {
        if (!program.source) throw new Error('Missing media source');
        const sourceCancel = new AbortController();
        const cancelled = () => sourceCancel.abort(cancel.signal.reason);
        cancel.signal.addEventListener('abort', cancelled, { once: true });
        if (cancel.signal.aborted) cancelled();
        const sourceSignal = sourceCancel.signal;
        const durationEnd = new Error('Media duration completed');
        timer = setTimeout(
          () => sourceCancel.abort(new Error('Media capture did not start within 10 seconds')),
          10_000
        );
        let mediaStarted: number | undefined;
        let smoothed = 0,
          next = 0;
        try {
          const samples =
            program.source.kind === 'samples'
              ? this.inputSamples(job, sourceSignal)
              : mediaSamples(program.source, sourceSignal);
          for await (const sample of samples) {
            cancel.signal.throwIfAborted();
            if (mediaStarted === undefined) {
              mediaStarted = Date.now();
              clearTimeout(timer);
              timer = setTimeout(() => sourceCancel.abort(durationEnd), program.duration * 1000);
            }
            if (Date.now() >= mediaStarted + program.duration * 1000) break;
            await delay(Math.max(0, next - Date.now()), undefined, { signal: cancel.signal });
            job.status.lastSample = sample;
            if ('rms' in sample) {
              smoothed = 0.35 * Math.min(1, sample.rms * program.gain) + 0.65 * smoothed;
              await this.command(job, 'brightness', { value: Math.round(smoothed * program.maxBrightness) });
            } else {
              const hex = sample.rgb.map((value) => value.toString(16).padStart(2, '0')).join('');
              if (hex === '000000') await this.command(job, 'brightness', { value: 0 });
              else await this.command(job, 'color', { color: `#${hex}`, brightness: program.maxBrightness });
            }
            next = Date.now() + 500;
          }
        } catch (error) {
          if (error !== durationEnd || cancel.signal.aborted) throw error;
        } finally {
          cancel.signal.removeEventListener('abort', cancelled);
        }
        if (!job.status.frames) throw new Error('Media source produced no usable control frames');
      }
      job.status.state = 'completed';
    } catch (error) {
      job.status.state = cancel.signal.aborted ? 'cancelled' : 'failed';
      job.status.error = (error as Error).message;
    } finally {
      clearTimeout(timer);
      if (before && job.restore) {
        const outcome = job.status.state;
        job.status.state = 'restoring';
        try {
          if (job.changed) await this.controller.restore(before);
          if (held)
            for (const [key, until] of Object.entries(prior))
              await this.controller.override([key], Math.max(0, (until - Date.now()) / 60_000));
          job.status.state = cancel.signal.aborted && outcome !== 'failed' ? 'cancelled' : outcome;
        } catch (error) {
          job.status.state = 'failed';
          job.status.error = `${job.status.error ? `${job.status.error}; ` : ''}Restoration failed: ${(error as Error).message}`;
        }
      }
      if (job.status.state === 'failed') console.error(`Program ${job.status.id} failed: ${job.status.error}`);
    }
  }
}
