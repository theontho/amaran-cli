import { z } from 'zod';
import { capabilities, validateAction } from './controller.js';
import { desktopRows } from './desktop.js';
import { type LibraryImport, SavedStateSchema } from './library.js';
import type { MeshConfig, MeshLight } from './storage.js';
import type { FixtureState } from './telink.js';

const Id = z
  .string()
  .regex(/^[0-9a-f-]+$/i)
  .transform((value) => value.replaceAll('-', '').toLowerCase());
const Named = z.object({ uuid: Id, name: z.string(), update_time: z.number() });
const Params = z
  .object({
    cct: z.number().optional(),
    gm: z.number().optional(),
    intensity: z.number().int().min(0).max(1000),
    sleep: z.boolean(),
    hue: z.number().optional(),
    sat: z.number().optional(),
    saturation: z.number().optional(),
  })
  .strict();

export function desktopState(
  light: MeshLight,
  mode: number,
  value: unknown,
  updated: number
): z.infer<typeof SavedStateSchema> {
  const data = Params.parse(value);
  const observedAt = new Date(updated).toISOString();
  const intensity = Math.round(data.intensity / 10) * 10;
  let state: FixtureState;
  if (mode === 0 && data.cct !== undefined) {
    state = { mode: 'cct', cct: Math.round(data.cct / 100) * 100, sleep: data.sleep, intensity, observedAt };
    if (capabilities(light).gm_support) {
      if (data.gm === undefined || data.gm < 0 || data.gm > 200)
        throw new Error('Expected Desktop tint in 0-200 units');
      state.gm = Math.round((data.gm - 100) / 10) * 10;
    }
    validateAction(light, 'cct', {
      kelvin: state.cct,
      brightness: intensity / 10,
      ...(state.gm === undefined ? {} : { gm: state.gm }),
    });
  } else if (mode === 1 && data.hue !== undefined && (data.sat ?? data.saturation) !== undefined) {
    state = { mode: 'hsi', hue: data.hue, sat: data.sat ?? data.saturation, sleep: data.sleep, intensity, observedAt };
    validateAction(light, 'hsi', { hue: state.hue, saturation: state.sat, brightness: intensity / 10 });
  } else throw new Error(`Unsupported Desktop light mode ${mode}; no settings guessed`);
  return SavedStateSchema.parse(state);
}

export function planDesktopImport(database: string, config: MeshConfig, prefix = 'Desktop', read = desktopRows) {
  z.string().trim().min(1).max(30).parse(prefix);
  const fixtures = z
    .array(z.object({ uuid: Id, mac_address: z.string(), code: z.string() }))
    .parse(read(database, 'SELECT uuid, mac_address, code FROM fixtures'));
  const mapping = new Map<string, MeshLight>();
  for (const fixture of fixtures) {
    const compact = fixture.mac_address.replace(/[^0-9a-f]/gi, '').toUpperCase();
    const light = config.lights.find((item) => item.mac.replace(/[^0-9a-f]/gi, '').toUpperCase() === compact);
    if (light) {
      mapping.set(`${fixture.code}-${compact.slice(-6)}`.toUpperCase(), light);
      mapping.set(fixture.uuid.toUpperCase(), light);
    }
  }
  const sceneRows = z.array(Named).parse(read(database, 'SELECT uuid, name, update_time FROM scenes'));
  const sceneDetails = z
    .array(z.object({ scene_uuid: Id, node_name: z.string() }))
    .parse(read(database, 'SELECT scene_uuid, node_name FROM scene_detail'));
  const groups = z
    .array(Named.extend({ scene_uuid: z.string() }))
    .parse(read(database, 'SELECT uuid, name, scene_uuid, update_time FROM groups'));
  const groupDetails = z
    .array(z.object({ group_uuid: Id, node_name: z.string() }))
    .parse(read(database, 'SELECT group_uuid, node_name FROM group_detail'));
  const shots = z.array(Named).parse(read(database, 'SELECT uuid, name, update_time FROM quick_shots'));
  const details = z
    .array(
      z.object({
        quick_shot_id: Id,
        node_name: z.string(),
        light_mode: z.number().int(),
        parameters: z.string(),
        update_time: z.number(),
      })
    )
    .parse(
      read(database, 'SELECT quick_shot_id, node_name, light_mode, parameters, update_time FROM quickshot_detail')
    );
  const presets = read(database, 'SELECT id, category, type, name, data, update_time FROM presets');
  const errors: string[] = [];
  const warnings = [
    'Desktop scenes are workspaces, not lighting snapshots; they are imported as local groups. Native subscriptions and fan profiles are not changed.',
  ];
  if (presets.length) errors.push(`${presets.length} Desktop presets use an unverified schema and were not converted`);
  const plan: LibraryImport = { groups: [], entries: [] };
  const resolve = (names: string[]): string[] => [
    ...new Set(
      names.map((name) => {
        const light = mapping.get(name.toUpperCase());
        if (!light) throw new Error(`Unmapped fixture ${name}`);
        return light.key;
      })
    ),
  ];
  for (const scene of sceneRows) {
    try {
      plan.groups.push({
        id: `group:desktop:scene:${scene.uuid}`,
        name: `${prefix}: workspace ${scene.name}`,
        members: resolve(sceneDetails.filter((item) => item.scene_uuid === scene.uuid).map((item) => item.node_name)),
      });
    } catch (error) {
      errors.push(`Workspace ${scene.name}: ${(error as Error).message}`);
    }
  }
  for (const group of groups) {
    try {
      const workspace = sceneRows.find((item) => item.uuid === group.scene_uuid.replaceAll('-', '').toLowerCase());
      const members = groupDetails.filter((item) => item.group_uuid === group.uuid).map((item) => item.node_name);
      if (!members.length) {
        warnings.push(`Skipped empty or implicit Desktop group ${group.name}; membership was not guessed`);
        continue;
      }
      plan.groups.push({
        id: `group:desktop:group:${group.uuid}`,
        name: `${prefix}: ${workspace ? `${workspace.name} / ` : ''}${group.name}`,
        members: resolve(members),
      });
    } catch (error) {
      errors.push(`Group ${group.name}: ${(error as Error).message}`);
    }
  }
  for (const shot of shots) {
    try {
      const states: Record<string, z.infer<typeof SavedStateSchema>> = {};
      const rows = details.filter((item) => item.quick_shot_id === shot.uuid);
      if (!rows.length) throw new Error('No fixture states');
      for (const row of rows) {
        const light = mapping.get(row.node_name.toUpperCase());
        if (!light) throw new Error(`Unmapped fixture ${row.node_name}`);
        if (states[light.key]) throw new Error(`Duplicate fixture ${light.key}`);
        states[light.key] = desktopState(
          light,
          row.light_mode,
          JSON.parse(row.parameters),
          row.update_time || shot.update_time
        );
      }
      plan.entries.push({
        collection: 'quickshots',
        entry: { id: `desktop:quickshot:${shot.uuid}`, name: `${prefix}: ${shot.name}`, states },
      });
    } catch (error) {
      errors.push(`Quickshot ${shot.name}: ${(error as Error).message}`);
    }
  }
  return { plan, errors, warnings };
}
