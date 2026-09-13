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
const PresetRow = z.object({
  id: Id,
  category: z.number().int(),
  type: z.number().int(),
  name: z.string().trim().min(1),
  data: z.string(),
  update_time: z.number().nullable(),
});
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
const EffectBase = {
  sleep: z.boolean(),
  intensity: z.number().int().min(0).max(100),
  frequency: z.number().int().min(1).max(10),
};
const EffectCct = {
  cct: z.number().int(),
  gm: z.number().min(0).max(200),
};
const EffectHsi = {
  hue: z.number().min(0).max(360),
  sat: z.number().min(0).max(100),
};
const Trigger = {
  trigger_mode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
};
const EffectMode = {
  effect_mode: z.union([z.literal(0), z.literal(1)]),
};

const DesktopEffects = {
  4: {
    effect: 'paparazzi',
    schema: z.object({ ...EffectBase, ...EffectCct }).strict(),
  },
  5: {
    effect: 'lightning',
    schema: z.object({ ...EffectBase, speed: z.number().int().min(0).max(10), ...Trigger, ...EffectCct }).strict(),
  },
  6: {
    effect: 'tv',
    schema: z.object({ ...EffectBase, cct_type: z.number().int().min(0).max(2) }).strict(),
  },
  8: {
    effect: 'fire',
    schema: z.object({ ...EffectBase, cct_type: z.number().int().min(0).max(2) }).strict(),
  },
  9: {
    effect: 'strobe',
    schema: z.object({ ...EffectBase, ...Trigger, ...EffectMode, ...EffectCct, ...EffectHsi }).strict(),
  },
  10: {
    effect: 'explosion',
    schema: z.object({ ...EffectBase, ...Trigger, ...EffectMode, ...EffectCct, ...EffectHsi }).strict(),
  },
  11: {
    effect: 'faulty-bulb',
    schema: z
      .object({
        ...EffectBase,
        speed: z.number().int().min(0).max(10),
        ...Trigger,
        ...EffectMode,
        ...EffectCct,
        ...EffectHsi,
      })
      .strict(),
  },
  12: {
    effect: 'pulsing',
    schema: z
      .object({
        ...EffectBase,
        speed: z.number().int().min(0).max(10),
        ...Trigger,
        ...EffectMode,
        ...EffectCct,
        ...EffectHsi,
      })
      .strict(),
  },
  14: {
    effect: 'cop-car',
    schema: z.object({ ...EffectBase, color: z.number().int().min(0).max(2) }).strict(),
  },
  16: {
    effect: 'party-lights',
    schema: z.object({ ...EffectBase, sat: z.number().min(0).max(100) }).strict(),
  },
  17: {
    effect: 'fireworks',
    schema: z.object({ ...EffectBase, type: z.number().int().min(0).max(2) }).strict(),
  },
} as const;

function effectTint(gm: number): number {
  return Math.round((gm - 100) / 10) * 10;
}

export function desktopEffectState(
  light: MeshLight,
  type: number,
  value: unknown,
  updated: number
): z.infer<typeof SavedStateSchema> {
  const definition = DesktopEffects[type as keyof typeof DesktopEffects];
  if (!definition) throw new Error(`Unsupported Desktop effect type ${type}`);
  const data = definition.schema.parse(value) as Record<string, number | boolean>;
  const state: FixtureState = {
    mode: 'effect',
    effect: definition.effect,
    sleep: data.sleep as boolean,
    intensity: (data.intensity as number) * 10,
    frequency: data.frequency as number,
    observedAt: new Date(updated).toISOString(),
  };
  if ('speed' in data) state.speed = data.speed as number;
  if ('trigger_mode' in data) state.trigger = data.trigger_mode as 0 | 1 | 2;
  if ('effect_mode' in data && data.effect_mode === 1) {
    state.hue = data.hue as number;
    state.sat = data.sat as number;
  } else if ('cct' in data) {
    state.cct = Math.round((data.cct as number) / 100) * 100;
    const gm = effectTint(data.gm as number);
    if (capabilities(light).gm_support) state.gm = gm;
    else if (gm !== 0) throw new Error(`${light.name} cannot reproduce non-neutral G/M`);
  }
  if ('cct_type' in data) state.palette = data.cct_type as number;
  if ('color' in data) state.palette = data.color as number;
  if ('type' in data) state.palette = data.type as number;
  if (definition.effect === 'party-lights') state.sat = data.sat as number;
  const body: Record<string, unknown> = {
    name: state.effect,
    brightness: state.intensity / 10,
    frequency: state.frequency,
    ...(state.speed === undefined ? {} : { speed: state.speed }),
    ...(state.trigger === undefined ? {} : { trigger: state.trigger }),
    ...(state.cct === undefined ? {} : { kelvin: state.cct }),
    ...(state.gm === undefined ? {} : { gm: state.gm }),
    ...(state.hue === undefined ? {} : { hue: state.hue }),
    ...(state.sat === undefined ? {} : { saturation: state.sat }),
    ...(state.palette === undefined ? {} : { palette: state.palette }),
  };
  validateAction(light, 'effect', body);
  return SavedStateSchema.parse(state);
}

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
  const presets = z
    .array(PresetRow)
    .parse(read(database, 'SELECT id, category, type, name, data, update_time FROM presets'))
    .sort((a, b) => (a.update_time ?? 0) - (b.update_time ?? 0) || a.id.localeCompare(b.id));
  const errors: string[] = [];
  const warnings = [
    'Desktop scenes are workspaces, not lighting snapshots; they are imported as local groups. Native subscriptions and fan profiles are not changed.',
  ];
  const plan: LibraryImport = { groups: [], entries: [] };
  const presetNames = new Set<string>();
  const importedName = (name: string): string => {
    const base = `${prefix}: ${name}`;
    let candidate = base.slice(0, 80);
    for (let duplicate = 2; presetNames.has(candidate.toLowerCase()); duplicate++) {
      const suffix = ` (${duplicate})`;
      candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`;
    }
    presetNames.add(candidate.toLowerCase());
    return candidate;
  };
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
  for (const preset of presets) {
    if (preset.category !== 2) {
      warnings.push(`Skipped Desktop preset ${preset.name}: category ${preset.category} is not an effect preset`);
      continue;
    }
    try {
      const data = JSON.parse(preset.data);
      const failures: string[] = [];
      let selected: { light: MeshLight; state: z.infer<typeof SavedStateSchema> } | undefined;
      for (const light of config.lights) {
        try {
          selected = {
            light,
            state: desktopEffectState(light, preset.type, data, preset.update_time ?? 0),
          };
          break;
        } catch (error) {
          failures.push(`${light.key}: ${(error as Error).message}`);
        }
      }
      if (!selected)
        throw new Error(`No configured fixture can reproduce it (${failures.join('; ') || 'no fixtures configured'})`);
      plan.entries.push({
        collection: 'presets',
        entry: {
          id: `desktop:preset:${preset.id}`,
          name: importedName(preset.name),
          states: { [selected.light.key]: selected.state },
        },
      });
    } catch (error) {
      errors.push(`Effect preset ${preset.name}: ${(error as Error).message}`);
    }
  }
  return { plan, errors, warnings };
}
