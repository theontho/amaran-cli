import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BatchResult } from '../ble/controller.js';
import * as media from '../ble/media.js';

afterEach(() => vi.restoreAllMocks());

import { decodeAudio, decodeImage, MediaSourceSchema } from '../ble/media.js';
import { ProgramSchema, Programs } from '../ble/programs.js';
import type { MeshConfig } from '../ble/storage.js';
import type { FixtureState } from '../ble/telink.js';

function controller() {
  let state: FixtureState = {
    mode: 'cct',
    cct: 3200,
    gm: 0,
    intensity: 10,
    sleep: false,
    observedAt: new Date().toISOString(),
  };
  const config: MeshConfig = {
    source: 32766,
    netKey: '0'.repeat(32),
    appKey: '1'.repeat(32),
    lights: [{ key: 'back', name: 'Back', mac: '', address: 10, model: '150c' }],
  };
  return {
    config,
    snapshot: vi.fn(async () => ({ back: structuredClone(state) })),
    overrideStatus: () => ({ back: 0 }),
    override: vi.fn(async () => ({ back: 0 })),
    reserveControl: vi.fn(async () => undefined),
    batch: vi.fn(async (_keys: string[], action: string, body: Record<string, unknown>): Promise<BatchResult> => {
      if (action === 'brightness') state.intensity = Number(body.value) * 10;
      return { delivery: 'batched-unicast', states: { back: structuredClone(state) } };
    }),
    restore: vi.fn(async (states: Record<string, FixtureState>) => {
      state = structuredClone(states.back);
      return states;
    }),
    state: () => state,
  };
}
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for program');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('bounded media programs', () => {
  it('accepts validated numeric samples without capturing devices in the daemon', async () => {
    const control = controller();
    const jobs = new Programs(control, () => ['back']);
    const job = await jobs.start({
      kind: 'picker',
      targets: 'all',
      duration: 1,
      source: { kind: 'samples', media: 'image' },
    });
    jobs.sample(job.id, { rgb: [0, 255, 0] });
    await waitFor(() => jobs.get(job.id).frames > 0);
    expect(control.batch).toHaveBeenCalledWith(
      ['back'],
      'color',
      { color: '#00ff00', brightness: 100 },
      false,
      expect.any(AbortSignal)
    );
    expect(() => jobs.sample(job.id, { rms: 0.5 })).toThrow('kind');
    expect(() => jobs.sample(job.id, { rgb: [0, 256, 0] })).toThrow();
    await waitFor(() => jobs.get(job.id).state === 'completed');
    expect(() => jobs.sample(job.id, { rgb: [0, 255, 0] })).toThrow('not accepting');
    await jobs.close();
  });
  it('starts the media duration after the first frame, not during source initialization', async () => {
    vi.spyOn(media, 'mediaCommand').mockReturnValue({ executable: 'unused', args: [], frameBytes: 4, audio: true });
    vi.spyOn(media, 'mediaSamples').mockImplementation(async function* () {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      yield { rms: 0.5 };
    });
    const control = controller();
    const jobs = new Programs(control, () => ['back']);
    const job = await jobs.start({
      kind: 'audio',
      targets: 'all',
      duration: 1,
      source: { kind: 'microphone', device: 0 },
    });
    await waitFor(() => ['completed', 'failed'].includes(jobs.get(job.id).state));
    expect(jobs.get(job.id)).toMatchObject({ state: 'completed', frames: 1 });
    await jobs.close();
  });
  it('validates cue ordering, source kinds and camera input before operation', () => {
    expect(() =>
      ProgramSchema.parse({
        kind: 'timeline',
        targets: 'all',
        duration: 1,
        steps: [
          { at: 1, action: 'brightness', args: { value: 1 } },
          { at: 0, action: 'off', args: {} },
        ],
      })
    ).toThrow();
    expect(() =>
      ProgramSchema.parse({ kind: 'audio', targets: 'all', source: { kind: 'camera', device: 0 } })
    ).toThrow();
    expect(() => MediaSourceSchema.parse({ kind: 'camera', device: -1 })).toThrow();
  });
  it('decodes RMS and image averages without accepting nonfinite samples', () => {
    const pcm = Buffer.alloc(8);
    pcm.writeFloatLE(0.5);
    pcm.writeFloatLE(-0.5, 4);
    expect(decodeAudio(pcm)).toEqual({ rms: 0.5 });
    pcm.writeFloatLE(NaN);
    expect(() => decodeAudio(pcm)).toThrow('Nonfinite');
    expect(decodeImage(Buffer.from([0, 255, 0, 255, 0, 0]))).toEqual({ rgb: [128, 128, 0] });
  });
  it('runs a timeline and restores the original settings and override', async () => {
    const control = controller();
    const jobs = new Programs(control, () => ['back']);
    const job = await jobs.start({
      kind: 'timeline',
      targets: 'all',
      duration: 1,
      steps: [{ at: 0, action: 'brightness', args: { value: 2 } }],
    });
    await waitFor(() => jobs.get(job.id).state === 'completed');
    expect(jobs.get(job.id).frames).toBe(1);
    expect(control.state().intensity).toBe(10);
    expect(control.restore).toHaveBeenCalledOnce();
    expect(control.override).toHaveBeenLastCalledWith(['back'], 0);
    await jobs.close();
  });
  it('manual takeover cancels future cues without restoring over the new intent', async () => {
    const control = controller();
    const jobs = new Programs(control, () => ['back']);
    const job = await jobs.start({
      kind: 'timeline',
      targets: 'all',
      duration: 2,
      steps: [
        { at: 0, action: 'brightness', args: { value: 2 } },
        { at: 1, action: 'brightness', args: { value: 3 } },
      ],
    });
    await waitFor(() => jobs.get(job.id).frames === 1);
    await jobs.cancelTargets(['back']);
    expect(jobs.get(job.id).state).toBe('cancelled');
    expect(control.batch).toHaveBeenCalledOnce();
    expect(control.restore).not.toHaveBeenCalled();
    await jobs.close();
  });
  it('newer concurrent requests supersede a queued start for the same targets', async () => {
    const control = controller();
    const jobs = new Programs(control, () => ['back']);
    const program = {
      kind: 'timeline',
      targets: 'all',
      duration: 1,
      steps: [{ at: 0.5, action: 'brightness', args: { value: 2 } }],
    };
    const results = await Promise.allSettled([jobs.start(program), jobs.start(program)]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    await jobs.close();
    expect(jobs.list().every((job) => !['running', 'preparing', 'restoring'].includes(job.state))).toBe(true);
  });
  it('surfaces a failed cue and prevents later writes', async () => {
    const control = controller();
    control.batch.mockRejectedValueOnce(new Error('fixture offline'));
    const jobs = new Programs(control, () => ['back']);
    const job = await jobs.start({
      kind: 'timeline',
      targets: 'all',
      duration: 2,
      steps: [
        { at: 0, action: 'brightness', args: { value: 2 } },
        { at: 1, action: 'brightness', args: { value: 3 } },
      ],
    });
    await waitFor(() => jobs.get(job.id).state === 'failed');
    expect(jobs.get(job.id).error).toContain('fixture offline');
    expect(control.batch).toHaveBeenCalledOnce();
    expect(control.restore).toHaveBeenCalledOnce();
    await jobs.close();
  });
});
