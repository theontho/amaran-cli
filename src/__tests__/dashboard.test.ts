import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardStore, estimateLux } from '../ble/dashboard.js';

describe('DashboardStore', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('persists validated settings and a timestamped status cache', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-dashboard-'));
    directories.push(directory);
    const store = new DashboardStore(directory, ['desk', 'back']);

    expect(store.updateSettings({ title: 'Studio', fixtureOrder: ['back'] }, ['desk', 'back'])).toMatchObject({
      title: 'Studio',
      fixtureOrder: ['back', 'desk'],
    });
    store.saveStatus({
      version: 1,
      updatedAt: '2026-01-01T12:00:00.000Z',
      connected: true,
      lighting: {},
      fans: {},
      estimatedLux: {},
    });

    expect(new DashboardStore(directory, ['desk', 'back']).getStatus()).toMatchObject({
      updatedAt: '2026-01-01T12:00:00.000Z',
      connected: true,
    });
    expect(JSON.parse(readFileSync(path.join(directory, 'dashboard-settings.json'), 'utf8'))).toMatchObject({
      title: 'Studio',
    });
    expect(JSON.parse(readFileSync(path.join(directory, 'dashboard-status.json'), 'utf8'))).toMatchObject({
      connected: true,
    });
  });

  it('rejects unknown and duplicate fixture registrations', () => {
    const store = new DashboardStore(undefined, ['desk', 'back']);
    expect(() => store.updateSettings({ fixtureOrder: ['missing'] }, ['desk', 'back'])).toThrow('unknown');
    expect(() => store.updateSettings({ fixtureOrder: ['desk', 'desk'] }, ['desk', 'back'])).toThrow('duplicate');
  });

  it('interpolates calibrated CCT output and scales it by live brightness', () => {
    const state = {
      sleep: false,
      intensity: 500,
      mode: 'cct' as const,
      cct: 4500,
      observedAt: '2026-01-01T12:00:00.000Z',
    };
    expect(estimateLux({ 4000: 10000, 5000: 14000 }, state)).toBe(6000);
    expect(estimateLux(8000, { ...state, intensity: 250 })).toBe(2000);
    expect(estimateLux(8000, { ...state, sleep: true })).toBe(0);
    expect(estimateLux(8000, { ...state, mode: 'hsi', hue: 0, sat: 100 })).toBeNull();
  });
});
