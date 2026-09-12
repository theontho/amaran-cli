import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getConfigDir } from '../config.js';

export const MeshConfigSchema = z
  .object({
    netKey: z.string().regex(/^[0-9a-f]{32}$/i),
    appKey: z.string().regex(/^[0-9a-f]{32}$/i),
    source: z.number().int().min(2).max(0x7fff),
    lights: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9_-]+$/i),
          name: z.string().min(1),
          mac: z.string(),
          address: z.number().int().min(2).max(0x7fff),
          model: z.enum(['200x', '200x-s', '150c']),
          deviceKey: z
            .string()
            .regex(/^[0-9a-f]{32}$/i)
            .optional(),
        })
      )
      .min(1),
  })
  .superRefine((config, ctx) => {
    const addresses = config.lights.flatMap((light) => [light.address, light.address + 1]);
    if (addresses.includes(config.source))
      ctx.addIssue({ code: 'custom', message: 'Controller source overlaps a fixture element' });
    if (new Set(addresses).size !== addresses.length)
      ctx.addIssue({ code: 'custom', message: 'Overlapping fixture elements' });
    if (new Set(config.lights.map((light) => light.key)).size !== config.lights.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate fixture keys' });
  });

export type MeshConfig = z.infer<typeof MeshConfigSchema>;
export type MeshLight = MeshConfig['lights'][number];
export const meshDirectory = (): string => path.join(getConfigDir(), 'ble');

export function atomicJson(filename: string, data: unknown): void {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, filename);
  const directory = openSync(path.dirname(filename), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function loadMeshConfig(directory = meshDirectory()): MeshConfig {
  return MeshConfigSchema.parse(JSON.parse(readFileSync(path.join(directory, 'mesh.json'), 'utf8')));
}

export class SequenceStore {
  private next = 0;
  private end = 0;
  private readonly filename: string;
  private readonly lock: string;
  private closed = false;

  constructor(
    directory: string,
    private readonly networkId: string,
    private readonly source: number
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.filename = path.join(directory, 'sequence.json');
    this.lock = path.join(directory, 'daemon.lock');
    if (existsSync(this.lock)) {
      const text = readFileSync(this.lock, 'utf8').trim();
      const pid = Number(text);
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH' && readFileSync(this.lock, 'utf8').trim() === text)
            unlinkSync(this.lock);
          else throw error;
        }
      }
    }
    try {
      closeSync(openSync(this.lock, 'wx', 0o600));
    } catch {
      throw new Error(
        `BLE state is locked: ${this.lock}. Stop the existing daemon; after a crash verify no daemon is running before removing this lock.`
      );
    }
    writeFileSync(this.lock, `${process.pid}\n`);
    try {
      if (!existsSync(this.filename))
        throw new Error(
          'Mesh sequence state is missing. Restore it from backup; never restart counters on an existing mesh.'
        );
      if (existsSync(this.filename)) {
        const saved = z
          .object({
            networkId: z.string(),
            source: z.number().int(),
            next: z.number().int().min(0).max(0x1000000),
          })
          .parse(JSON.parse(readFileSync(this.filename, 'utf8')));
        if (saved.networkId !== networkId || saved.source !== source)
          throw new Error('Mesh sequence identity changed; refusing to reuse counters');
        this.next = saved.next;
      }
      this.end = this.next;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  take(): number {
    if (this.closed) throw new Error('Sequence store is closed');
    if (this.next > 0xffffff) throw new Error('Mesh sequence exhausted; reprovision before sending more commands');
    if (this.next === this.end) {
      this.end = Math.min(this.next + 128, 0x1000000);
      atomicJson(this.filename, { networkId: this.networkId, source: this.source, next: this.end });
    }
    return this.next++;
  }

  close(): void {
    if (!this.closed) unlinkSync(this.lock);
    this.closed = true;
  }
}
