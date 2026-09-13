import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Script } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { DashboardStore, dashboardHtml, dashboardJs, estimateLux } from '../ble/dashboard.js';
import { getCircadianDashboardStatus } from '../daylightSimulation/dashboardStatus.js';

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

  it('reports the loaded circadian service, latest target, weather state, and capped daily schedule', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-circadian-dashboard-'));
    directories.push(directory);
    const agents = path.join(directory, 'Library', 'LaunchAgents');
    const logs = path.join(directory, 'Library', 'Logs');
    mkdirSync(agents, { recursive: true });
    mkdirSync(logs, { recursive: true });
    writeFileSync(
      path.join(agents, 'com.hmmfn.amaran.circadian-service.plist'),
      `<plist><dict><key>ProgramArguments</key><array><string>node</string><string>amaran-cli</string><string>auto-cct</string><string>--curve</string><string>cie-daylight</string></array><key>StartInterval</key><integer>60</integer></dict></plist>`
    );
    writeFileSync(
      path.join(logs, 'amaran-circadian-service.log'),
      '[2026-09-13T22:29:38.000Z] Setting CCT to 6002K at 25% for active lights\n'
    );

    const result = await getCircadianDashboardStatus({
      homeDir: directory,
      now: new Date('2026-09-13T22:30:00.000Z'),
      isServiceLoaded: async () => true,
      loadConfig: () => ({
        latitude: 37.7852,
        longitude: -122.3874,
        intensityMin: 5,
        intensityMax: 25,
        weather: false,
      }),
    });

    expect(result.service).toMatchObject({
      installed: true,
      loaded: true,
      active: true,
      healthy: true,
      intervalSeconds: 60,
      curve: 'cie-daylight',
      weatherConfigured: false,
      lastTarget: { cct: 6002, intensity: 25 },
    });
    expect(result.current).toMatchObject({ curve: 'cie-daylight', weatherActive: false });
    expect(result.schedule?.points).toHaveLength(97);
    expect(Math.max(...(result.schedule?.points.map((point) => point.intensity) ?? []))).toBeLessThanOrEqual(25);
  });

  it('ships a parseable interactive circadian dashboard client', () => {
    expect(() => new Script(dashboardJs)).not.toThrow();
    expect(dashboardHtml).toContain('id="circadian-graph"');
    expect(dashboardHtml).toContain('Hover or slide over the graph');
    expect(dashboardJs).toContain("api('/dashboard/circadian')");
    expect(dashboardJs).toContain('onpointermove');
  });
});
