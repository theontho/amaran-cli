import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { effectName } from './effects.js';
import { FanSettingSchema } from './fan.js';
import { atomicJson } from './storage.js';
import type { FixtureState } from './telink.js';

export const SavedStateSchema = z
  .object({
    sleep: z.boolean(),
    intensity: z.number().int().min(0).max(1000),
    mode: z.enum(['cct', 'hsi', 'effect']),
    cct: z.number().int().min(2500).max(7500).optional(),
    gm: z.number().min(-100).max(100).optional(),
    hue: z.number().min(0).max(360).optional(),
    sat: z.number().min(0).max(100).optional(),
    effect: z.string().transform(effectName).optional(),
    frequency: z.number().min(1).max(10).optional(),
    speed: z.literal(0).optional(),
    palette: z.number().min(0).max(2).optional(),
    observedAt: z.string().datetime(),
    fan: FanSettingSchema.optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (
      (state.mode === 'cct' && state.cct === undefined) ||
      (state.mode === 'hsi' && (state.hue === undefined || state.sat === undefined)) ||
      (state.mode === 'effect' && (!state.effect || state.frequency === undefined))
    ) {
      context.addIssue({ code: 'custom', message: 'Saved state is missing active-mode parameters' });
    }
  });
const Name = z.string().trim().min(1).max(80);
const Entry = z.object({ id: z.string(), name: Name, states: z.record(SavedStateSchema) });
const Group = z.object({
  id: z.string(),
  name: Name,
  members: z.array(z.string()).max(128),
  native: z
    .object({
      address: z.number().int().min(0xc000).max(0xfeff),
      status: z.enum(['pending', 'ready']),
      managed: z.array(z.string()).min(1),
    })
    .optional(),
});
export type LightingGroup = z.infer<typeof Group>;
const Schema = z.object({
  version: z.literal(1),
  scenes: z.array(Entry).max(128),
  presets: z.array(Entry).max(128),
  quickshots: z.array(Entry).max(128),
  groups: z.array(Group).max(128),
  steady: z.record(SavedStateSchema),
  overrides: z.record(z.number().int().nonnegative()).default({}),
});
export type LibraryCollection = 'scenes' | 'presets' | 'quickshots';
export type LibraryEntry = z.infer<typeof Entry>;
export interface LibraryImport {
  groups: { id: string; name: string; members: string[] }[];
  entries: { collection: LibraryCollection; entry: LibraryEntry }[];
}
export interface SteadyHistory {
  getSteady(key: string): FixtureState | undefined;
  saveSteady(key: string, state: FixtureState): void;
  getOverride?(key: string): number | undefined;
  setOverride?(key: string, until: number): void;
}

export class LocalLibrary implements SteadyHistory {
  private data: z.infer<typeof Schema> = {
    version: 1,
    scenes: [],
    presets: [],
    quickshots: [],
    groups: [],
    steady: {},
    overrides: {},
  };
  private readonly filename?: string;
  constructor(directory?: string) {
    if (directory) {
      this.filename = path.join(directory, 'library.json');
      if (existsSync(this.filename)) this.data = Schema.parse(JSON.parse(readFileSync(this.filename, 'utf8')));
    }
  }
  private commit(data: z.infer<typeof Schema>): void {
    const validated = Schema.parse(data);
    if (this.filename) atomicJson(this.filename, validated);
    this.data = validated;
  }
  list(collection: LibraryCollection): LibraryEntry[] {
    return structuredClone(this.data[collection]);
  }
  find(collection: LibraryCollection, key: string): LibraryEntry {
    const entry = this.data[collection].find(
      (item) => item.id === key || item.name.toLowerCase() === key.toLowerCase()
    );
    if (!entry) throw new Error(`Unknown ${collection} entry: ${key}`);
    return structuredClone(entry);
  }
  save(collection: LibraryCollection, name: unknown, states: Record<string, FixtureState>, key?: string): LibraryEntry {
    const normalized = Name.parse(name);
    const existing = key === undefined ? undefined : this.find(collection, key);
    if (!Object.keys(states).length) throw new Error('Cannot save an empty lighting state');
    if (collection === 'presets' && Object.keys(states).length !== 1)
      throw new Error('A preset stores exactly one fixture state');
    if (
      this.data[collection].some(
        (item) => item.name.toLowerCase() === normalized.toLowerCase() && item.id !== existing?.id
      )
    )
      throw new Error(`Name already exists: ${normalized}`);
    const entry = Entry.parse({ id: existing?.id ?? randomUUID(), name: normalized, states });
    const data = structuredClone(this.data);
    data[collection] = [...data[collection].filter((item) => item.id !== entry.id), entry];
    this.commit(data);
    return entry;
  }
  delete(collection: LibraryCollection, key: string): void {
    const entry = this.find(collection, key);
    const data = structuredClone(this.data);
    data[collection] = data[collection].filter((item) => item.id !== entry.id);
    this.commit(data);
  }
  groups(): z.infer<typeof Group>[] {
    return structuredClone(this.data.groups);
  }
  group(key: string): z.infer<typeof Group> {
    const group = this.data.groups.find((item) => item.id === key || item.name.toLowerCase() === key.toLowerCase());
    if (!group) throw new Error(`Unknown group: ${key}`);
    return structuredClone(group);
  }
  createGroup(name: unknown): z.infer<typeof Group> {
    const normalized = Name.parse(name);
    if (this.data.groups.some((item) => item.name.toLowerCase() === normalized.toLowerCase()))
      throw new Error(`Group name already exists: ${normalized}`);
    const group = { id: `group:${randomUUID()}`, name: normalized, members: [] };
    this.commit({ ...this.data, groups: [...this.data.groups, group] });
    return group;
  }
  deleteGroup(key: string): void {
    const group = this.group(key);
    if (group.native) throw new Error('Disable native subscriptions before deleting the group');
    this.commit({ ...this.data, groups: this.data.groups.filter((item) => item.id !== group.id) });
  }
  renameGroup(key: string, name: unknown): z.infer<typeof Group> {
    const group = this.group(key);
    const normalized = Name.parse(name);
    if (this.data.groups.some((item) => item.id !== group.id && item.name.toLowerCase() === normalized.toLowerCase()))
      throw new Error(`Group name already exists: ${normalized}`);
    group.name = normalized;
    this.commit({ ...this.data, groups: this.data.groups.map((item) => (item.id === group.id ? group : item)) });
    return group;
  }
  updateGroup(key: string, member: string, remove: boolean): void {
    const group = this.group(key);
    if (group.native?.status === 'ready')
      throw new Error('Native membership changes must be synchronized with the fixtures');
    if (remove && !group.members.includes(member)) throw new Error(`${member} is not in ${group.name}`);
    group.members = remove ? group.members.filter((item) => item !== member) : [...new Set([...group.members, member])];
    this.commit({ ...this.data, groups: this.data.groups.map((item) => (item.id === group.id ? group : item)) });
  }
  setNativeGroup(key: string, native: LightingGroup['native']): LightingGroup {
    const group = this.group(key);
    group.native = native;
    this.commit({ ...this.data, groups: this.data.groups.map((item) => (item.id === group.id ? group : item)) });
    return group;
  }
  importLibrary(plan: LibraryImport, apply: boolean, replace = false) {
    const next = structuredClone(this.data);
    let created = 0,
      updated = 0,
      unchanged = 0;
    const merge = <T extends { id: string; name: string }>(items: T[], incoming: T): T[] => {
      const existing = items.find((item) => item.id === incoming.id);
      if (items.some((item) => item.id !== incoming.id && item.name.toLowerCase() === incoming.name.toLowerCase()))
        throw new Error(`Import name conflicts with a local item: ${incoming.name}`);
      if (existing && JSON.stringify(existing) === JSON.stringify(incoming)) {
        unchanged++;
        return items;
      }
      if (existing && !replace) throw new Error(`Import would update ${incoming.name}; explicitly enable replacement`);
      if (existing) updated++;
      else created++;
      return [...items.filter((item) => item.id !== incoming.id), incoming];
    };
    for (const incoming of plan.groups) {
      if (next.groups.find((item) => item.id === incoming.id)?.native)
        throw new Error(`Disable native subscriptions before replacing imported group ${incoming.name}`);
      next.groups = merge(next.groups, Group.parse(incoming));
    }
    for (const { collection, entry } of plan.entries) next[collection] = merge(next[collection], Entry.parse(entry));
    Schema.parse(next);
    if (apply) this.commit(next);
    return { applied: apply, created, updated, unchanged };
  }
  getSteady(key: string): FixtureState | undefined {
    return this.data.steady[key] ? structuredClone(this.data.steady[key]) : undefined;
  }
  saveSteady(key: string, state: FixtureState): void {
    this.commit({ ...this.data, steady: { ...this.data.steady, [key]: SavedStateSchema.parse(state) } });
  }
  getOverride(key: string): number | undefined {
    return this.data.overrides[key];
  }
  setOverride(key: string, until: number): void {
    this.commit({ ...this.data, overrides: { ...this.data.overrides, [key]: until } });
  }
}
