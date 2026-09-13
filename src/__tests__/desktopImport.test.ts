import { describe, expect, it } from 'vitest';
import { desktopEffectState, desktopState, planDesktopImport } from '../ble/desktopLibrary.js';
import { LocalLibrary } from '../ble/library.js';
import type { MeshConfig } from '../ble/storage.js';

const light = { key: 'back', name: 'Back', mac: '00:00:00:12:34:56', address: 10, model: '150c' as const };
const desk = { key: 'desk', name: 'Desk', mac: '00:00:00:65:43:21', address: 6, model: '200x-s' as const };
const config: MeshConfig = { netKey: '0'.repeat(32), appKey: '1'.repeat(32), source: 32766, lights: [light] };

describe('Desktop library import', () => {
  it('converts Desktop tint units and preserves sleeping remembered brightness', () => {
    expect(desktopState(light, 0, { cct: 5600, gm: 100, intensity: 680, sleep: true }, 123)).toMatchObject({
      mode: 'cct',
      gm: 0,
      intensity: 680,
      sleep: true,
    });
    expect(desktopState(light, 0, { cct: 3200, gm: 70, intensity: 13, sleep: false }, 123)).toMatchObject({
      gm: -30,
      intensity: 10,
    });
    expect(() => desktopState(light, 7, {}, 123)).toThrow();
    expect(() => desktopState(light, 0, { cct: 3200, intensity: 10, sleep: false }, 123)).toThrow('tint');
  });
  it('maps quickshots and workspaces without importing credentials or applying lights', () => {
    const rows: Record<string, unknown[]> = {
      fixtures: [{ uuid: 'aa', mac_address: light.mac, code: '400J5' }],
      scenes: [{ uuid: 'bb', name: 'Studio', update_time: 123 }],
      scene_detail: [{ scene_uuid: 'bb', node_name: '400J5-123456' }],
      groups: [],
      group_detail: [],
      quick_shots: [{ uuid: 'cc', name: 'Night', update_time: 123 }],
      quickshot_detail: [
        {
          quick_shot_id: 'cc',
          node_name: '400J5-123456',
          light_mode: 0,
          parameters: '{"gm":100,"cct":2700,"intensity":10,"sleep":false}',
          update_time: 123,
        },
      ],
      presets: [],
    };
    const read = (_database: string, sql: string) => rows[sql.split(' FROM ')[1]];
    const report = planDesktopImport('unused', config, 'Imported', read);
    expect(report.errors).toEqual([]);
    expect(report.plan.groups[0].members).toEqual(['back']);
    expect(report.plan.entries[0].entry.states.back.gm).toBe(0);
    const library = new LocalLibrary();
    expect(library.importLibrary(report.plan, false)).toMatchObject({ applied: false, created: 2 });
    expect(library.groups()).toEqual([]);
    library.importLibrary(report.plan, true);
    expect(library.importLibrary(report.plan, true)).toMatchObject({ created: 0, unchanged: 2 });
    rows.quickshot_detail = [
      { quick_shot_id: 'cc', node_name: 'unknown', light_mode: 0, parameters: '{}', update_time: 123 },
    ];
    expect(planDesktopImport('unused', config, 'Imported', read).errors[0]).toContain('Unmapped');
  });
  it('imports every supported Desktop effect preset with exact parameter conversion', () => {
    const effectRows = [
      [4, 'Paparazzi', { sleep: false, intensity: 50, frequency: 5, cct: 2500, gm: 70 }],
      [5, 'Lightning', { sleep: false, intensity: 51, frequency: 4, speed: 6, trigger_mode: 2, cct: 3200, gm: 100 }],
      [6, 'TV', { sleep: false, intensity: 52, frequency: 3, cct_type: 2 }],
      [8, 'Fire', { sleep: false, intensity: 53, frequency: 2, cct_type: 1 }],
      [
        9,
        'Strobe',
        {
          sleep: false,
          intensity: 54,
          frequency: 6,
          trigger_mode: 1,
          effect_mode: 0,
          cct: 3200,
          gm: 100,
          hue: 100,
          sat: 60,
        },
      ],
      [
        10,
        'Explosion',
        {
          sleep: true,
          intensity: 55,
          frequency: 7,
          trigger_mode: 2,
          effect_mode: 0,
          cct: 5600,
          gm: 100,
          hue: 110,
          sat: 61,
        },
      ],
      [
        11,
        'Faulty',
        {
          sleep: false,
          intensity: 56,
          frequency: 8,
          speed: 7,
          trigger_mode: 2,
          effect_mode: 1,
          cct: 4300,
          gm: 100,
          hue: 120,
          sat: 80,
        },
      ],
      [
        12,
        'Pulsing',
        {
          sleep: false,
          intensity: 57,
          frequency: 9,
          speed: 8,
          trigger_mode: 0,
          effect_mode: 0,
          cct: 4500,
          gm: 100,
          hue: 130,
          sat: 70,
        },
      ],
      [14, 'Cop car', { sleep: false, intensity: 58, frequency: 5, color: 2 }],
      [16, 'Party', { sleep: false, intensity: 59, frequency: 4, sat: 66 }],
      [17, 'Fireworks', { sleep: false, intensity: 60, frequency: 3, type: 1 }],
    ] as const;
    const rows: Record<string, unknown[]> = {
      fixtures: [
        { uuid: 'aa', mac_address: desk.mac, code: '400Q5' },
        { uuid: 'ab', mac_address: light.mac, code: '400J5' },
      ],
      scenes: [],
      scene_detail: [],
      groups: [],
      group_detail: [],
      quick_shots: [],
      quickshot_detail: [],
      presets: effectRows.map(([type, name, data], index) => ({
        id: `${index + 1}`,
        category: 2,
        type,
        name,
        data: JSON.stringify(data),
        update_time: 1000 + index,
      })),
    };
    const read = (_database: string, sql: string) => rows[sql.split(' FROM ')[1]];
    const report = planDesktopImport('unused', { ...config, lights: [desk, light] }, 'Desktop', read);
    expect(report.errors).toEqual([]);
    const presets = report.plan.entries.filter((item) => item.collection === 'presets');
    expect(presets).toHaveLength(11);
    expect(presets.map((item) => Object.values(item.entry.states)[0].effect)).toEqual([
      'paparazzi',
      'lightning',
      'tv',
      'fire',
      'strobe',
      'explosion',
      'faulty-bulb',
      'pulsing',
      'cop-car',
      'party-lights',
      'fireworks',
    ]);
    expect(presets[0].entry.states.back).toMatchObject({ intensity: 500, cct: 2500, gm: -30 });
    expect(presets[1].entry.states.desk).toMatchObject({ speed: 6, trigger: 2 });
    expect(presets[4].entry.states.desk).toMatchObject({ trigger: 1, cct: 3200 });
    expect(presets[6].entry.states.back).toMatchObject({ hue: 120, sat: 80, speed: 7, trigger: 2 });
    expect(presets[8].entry.states.back).toMatchObject({ palette: 2 });
    expect(presets[9].entry.states.back).toMatchObject({ sat: 66 });
    expect(presets[10].entry.states.desk).toMatchObject({ palette: 1 });
  });
  it('keeps duplicate Desktop names and rejects unrepresentable effect records', () => {
    const rows: Record<string, unknown[]> = {
      fixtures: [{ uuid: 'aa', mac_address: light.mac, code: '400J5' }],
      scenes: [],
      scene_detail: [],
      groups: [],
      group_detail: [],
      quick_shots: [],
      quickshot_detail: [],
      presets: [
        {
          id: 'a1',
          category: 2,
          type: 4,
          name: 'Effect',
          data: '{"sleep":false,"intensity":50,"frequency":5,"cct":2500,"gm":100}',
          update_time: 1,
        },
        {
          id: 'a2',
          category: 2,
          type: 4,
          name: 'Effect',
          data: '{"sleep":false,"intensity":50,"frequency":5,"cct":2500,"gm":100}',
          update_time: 2,
        },
        { id: 'a3', category: 2, type: 3, name: 'Club', data: '{}', update_time: 3 },
        { id: 'a4', category: 1, type: 1, name: 'Color', data: '{}', update_time: 4 },
      ],
    };
    const read = (_database: string, sql: string) => rows[sql.split(' FROM ')[1]];
    const report = planDesktopImport('unused', config, 'Imported', read);
    expect(report.plan.entries.map((item) => item.entry.name)).toEqual(['Imported: Effect', 'Imported: Effect (2)']);
    expect(report.errors).toEqual([expect.stringContaining('Unsupported Desktop effect type 3')]);
    expect(report.warnings).toContain('Skipped Desktop preset Color: category 1 is not an effect preset');
  });
  it('validates Desktop effect fields against the destination fixture', () => {
    expect(
      desktopEffectState(
        light,
        11,
        {
          sleep: false,
          intensity: 50,
          frequency: 5,
          speed: 4,
          trigger_mode: 1,
          effect_mode: 1,
          cct: 3200,
          gm: 100,
          hue: 240,
          sat: 75,
        },
        123
      )
    ).toMatchObject({ effect: 'faulty-bulb', intensity: 500, speed: 4, trigger: 1, hue: 240, sat: 75 });
    expect(() =>
      desktopEffectState(desk, 4, { sleep: false, intensity: 50, frequency: 5, cct: 3200, gm: 70 }, 123)
    ).toThrow('non-neutral G/M');
  });
  it('does not silently replace local or native records', () => {
    const library = new LocalLibrary();
    const plan = { groups: [{ id: 'group:desktop:test', name: 'Imported', members: ['back'] }], entries: [] };
    library.importLibrary(plan, true);
    expect(() => library.importLibrary({ ...plan, groups: [{ ...plan.groups[0], name: 'Changed' }] }, true)).toThrow(
      'replacement'
    );
    library.setNativeGroup(plan.groups[0].id, { address: 0xc100, managed: ['back'], status: 'ready' });
    expect(() => library.importLibrary(plan, true, true)).toThrow('native subscriptions');
  });
});
