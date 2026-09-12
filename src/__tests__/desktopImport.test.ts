import { describe, expect, it } from 'vitest';
import { desktopState, planDesktopImport } from '../ble/desktopLibrary.js';
import { LocalLibrary } from '../ble/library.js';
import type { MeshConfig } from '../ble/storage.js';

const light = { key: 'back', name: 'Back', mac: '00:00:00:12:34:56', address: 10, model: '150c' as const };
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
