import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const Region = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const MediaSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('samples'), media: z.enum(['audio', 'image']) }).strict(),
  z.object({ kind: z.literal('audio-file'), file: z.string() }).strict(),
  z.object({ kind: z.literal('microphone'), device: z.number().int().min(0).max(64) }).strict(),
  z.object({ kind: z.literal('image-file'), file: z.string(), region: Region.optional() }).strict(),
  z.object({ kind: z.literal('camera'), device: z.number().int().min(0).max(64), region: Region.optional() }).strict(),
]);
export type MediaSource = z.infer<typeof MediaSourceSchema>;
export type MediaSample = { rms: number } | { rgb: [number, number, number] };
export const MediaSampleSchema = z.union([
  z.object({ rms: z.number().min(0).max(1) }).strict(),
  z
    .object({
      rgb: z.tuple([
        z.number().int().min(0).max(255),
        z.number().int().min(0).max(255),
        z.number().int().min(0).max(255),
      ]),
    })
    .strict(),
]);

export function mediaExecutable(): string {
  const configured = process.env.AMARAN_FFMPEG_PATH;
  const candidates = configured
    ? [configured]
    : [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        ...(process.env.PATH ?? '')
          .split(path.delimiter)
          .filter((directory) => path.isAbsolute(directory))
          .map((directory) => path.join(directory, 'ffmpeg')),
      ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    accessSync(candidate, constants.X_OK);
    const resolved = realpathSync(candidate);
    if (!statSync(resolved).isFile()) throw new Error('Configured ffmpeg executable is not a file');
    return resolved;
  }
  throw new Error('ffmpeg was not found; install it or set AMARAN_FFMPEG_PATH to its executable');
}

export function decodeAudio(data: Buffer): MediaSample {
  let squares = 0;
  if (!data.length || data.length % 4) throw new Error('Invalid PCM frame');
  for (let i = 0; i < data.length; i += 4) {
    const value = data.readFloatLE(i);
    if (!Number.isFinite(value)) throw new Error('Nonfinite audio sample');
    squares += value * value;
  }
  return { rms: Math.min(1, Math.sqrt(squares / (data.length / 4))) };
}
export function decodeImage(data: Buffer): MediaSample {
  if (!data.length || data.length % 3) throw new Error('Invalid RGB frame');
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < data.length; i++) rgb[i % 3] += data[i];
  for (let i = 0; i < 3; i++) rgb[i] = Math.round(rgb[i] / (data.length / 3));
  return { rgb };
}

export function mediaCommand(source: MediaSource): {
  executable: string;
  args: string[];
  frameBytes: number;
  audio: boolean;
} {
  if (source.kind === 'samples') throw new Error('Numeric sample streams do not start a media process');
  if (
    source.kind === 'camera' &&
    source.region &&
    (source.region.x + source.region.width > 1280 || source.region.y + source.region.height > 720)
  )
    throw new Error('Camera crop is outside the 1280x720 capture');
  const audio = source.kind === 'audio-file' || source.kind === 'microphone';
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file,pipe'];
  if ('file' in source) {
    const file = realpathSync(source.file);
    if (!statSync(file).isFile()) throw new Error('Media source must be a local file');
    args.push('-re');
    if (source.kind === 'image-file') args.push('-loop', '1', '-framerate', '2');
    args.push('-i', file);
  } else {
    if (process.platform !== 'darwin') throw new Error('Live camera/microphone capture currently requires macOS');
    args.push('-f', 'avfoundation');
    if (source.kind === 'camera') args.push('-pixel_format', 'nv12', '-framerate', '30', '-video_size', '1280x720');
    args.push('-i', source.kind === 'camera' ? `${source.device}:none` : `none:${source.device}`);
  }
  args.push('-threads', '1');
  if (audio) args.push('-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1');
  else {
    const region = 'region' in source ? source.region : undefined;
    const crop = region ? `crop=${region.width}:${region.height}:${region.x}:${region.y},` : '';
    args.push('-an', '-vf', `${crop}fps=2,scale=32:32`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1');
  }
  return { executable: mediaExecutable(), args, frameBytes: audio ? 8000 * 4 : 32 * 32 * 3, audio };
}

export async function* mediaSamples(source: MediaSource, signal: AbortSignal): AsyncGenerator<MediaSample> {
  const command = mediaCommand(source);
  const child = spawn(command.executable, command.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let pending = Buffer.alloc(0),
    latest: MediaSample | undefined,
    failure: Error | undefined,
    ended = false,
    stderr = '';
  let wake: (() => void) | undefined;
  const notify = () => wake?.();
  child.stderr.on('data', (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-4096);
  });
  child.stdout.on('data', (data: Buffer) => {
    try {
      pending = Buffer.concat([pending, data]);
      while (pending.length >= command.frameBytes) {
        const frame = pending.subarray(0, command.frameBytes);
        pending = pending.subarray(command.frameBytes);
        latest = command.audio ? decodeAudio(frame) : decodeImage(frame);
      }
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }
    notify();
  });
  child.once('error', (error) => {
    failure = error;
    ended = true;
    notify();
  });
  const closed = new Promise<void>((resolve) =>
    child.once('close', (code) => {
      ended = true;
      if (code !== 0 && !signal.aborted) failure = new Error(stderr || `ffmpeg exited ${code}`);
      notify();
      resolve();
    })
  );
  const abort = () => {
    child.kill('SIGTERM');
    notify();
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      if (failure) throw failure;
      if (latest) {
        const sample = latest;
        latest = undefined;
        yield sample;
        continue;
      }
      if (ended) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          failure = new Error('No media frames received for 10 seconds');
          resolve();
        }, 10_000);
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
    }
  } finally {
    signal.removeEventListener('abort', abort);
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await closed;
    clearTimeout(timer);
  }
}
