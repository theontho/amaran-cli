import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config.js';
import { updateCircadianDashboardSettings } from '../daylightSimulation/dashboardSettings.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('circadian dashboard settings', () => {
  it('persists settings and reloads an installed service when launch arguments change', async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'amaran-circadian-settings-'));
    roots.push(homeDir);
    const agents = path.join(homeDir, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const plistPath = path.join(agents, 'com.hmmfn.amaran.circadian-service.plist');
    writeFileSync(
      plistPath,
      '<key>ProgramArguments</key><array><string>node</string><string>cli</string><string>auto-cct</string><string>--curve</string><string>cie-daylight</string></array><key>StartInterval</key><integer>60</integer>'
    );
    const saveConfig = vi.fn();
    const runLaunchctl = vi.fn(async () => undefined);

    await updateCircadianDashboardSettings(
      {
        enabled: true,
        intervalSeconds: 120,
        curve: 'physics',
        weather: true,
        cctMin: 2200,
        cctMax: 6500,
        extendCctBelowNative: false,
        extendCctAboveNative: false,
        intensityMin: 3,
        intensityMax: 25,
        latitude: 38.5,
        longitude: -122.5,
      },
      {
        homeDir,
        loadConfig: () => ({ backend: 'ble', bleApiKey: 'preserved' }),
        saveConfig,
        isServiceLoaded: async () => true,
        runLaunchctl,
      }
    );

    expect(saveConfig).toHaveBeenCalledWith({
      backend: 'ble',
      bleApiKey: 'preserved',
      defaultCurve: 'physics',
      weather: true,
      cctMin: 2200,
      cctMax: 6500,
      extendCctBelowNative: false,
      extendCctAboveNative: false,
      intensityMin: 3,
      intensityMax: 25,
      latitude: 38.5,
      longitude: -122.5,
    } satisfies Config);
    expect(readFileSync(plistPath, 'utf8')).toContain('<string>--curve</string><string>physics</string>');
    expect(readFileSync(plistPath, 'utf8')).toContain('<key>StartInterval</key><integer>120</integer>');
    expect(runLaunchctl).toHaveBeenNthCalledWith(1, ['unload', plistPath]);
    expect(runLaunchctl).toHaveBeenNthCalledWith(2, ['load', plistPath]);
  });

  it('rejects inconsistent bounds before saving', async () => {
    const saveConfig = vi.fn();
    await expect(
      updateCircadianDashboardSettings(
        { cctMin: 7000, cctMax: 3000 },
        {
          loadConfig: () => ({}),
          saveConfig,
        }
      )
    ).rejects.toThrow('cctMin must be <= cctMax');
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('persistently disables an installed service', async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'amaran-circadian-settings-'));
    roots.push(homeDir);
    const agents = path.join(homeDir, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const plistPath = path.join(agents, 'com.hmmfn.amaran.circadian-service.plist');
    writeFileSync(
      plistPath,
      '<string>--curve</string><string>cie-daylight</string><key>StartInterval</key><integer>60</integer>'
    );
    const runLaunchctl = vi.fn(async () => undefined);

    await updateCircadianDashboardSettings(
      { enabled: false },
      {
        homeDir,
        loadConfig: () => ({}),
        saveConfig: vi.fn(),
        isServiceLoaded: async () => true,
        runLaunchctl,
      }
    );

    expect(runLaunchctl).toHaveBeenCalledWith(['unload', '-w', plistPath]);
  });

  it('updates and controls a Linux user systemd timer', async () => {
    const homeDir = mkdtempSync(path.join(tmpdir(), 'amaran-circadian-settings-'));
    roots.push(homeDir);
    const unitDirectory = path.join(homeDir, '.config', 'systemd', 'user');
    mkdirSync(unitDirectory, { recursive: true });
    const servicePath = path.join(unitDirectory, 'amaran-circadian.service');
    const timerPath = path.join(unitDirectory, 'amaran-circadian.timer');
    writeFileSync(
      servicePath,
      '[Service]\nExecStart=/usr/local/bin/amaran-cli auto-cct --backend ble --service-mode --curve cie-daylight\n'
    );
    writeFileSync(timerPath, '[Timer]\nOnBootSec=45s\nOnUnitActiveSec=60s\n');
    const runSystemctl = vi.fn(async () => undefined);

    await updateCircadianDashboardSettings(
      { enabled: true, intervalSeconds: 120, curve: 'physics' },
      {
        platform: 'linux',
        homeDir,
        loadConfig: () => ({ backend: 'ble' }),
        saveConfig: vi.fn(),
        isSystemdTimerActive: async () => true,
        runSystemctl,
      }
    );

    expect(readFileSync(servicePath, 'utf8')).toContain('--curve physics');
    expect(readFileSync(timerPath, 'utf8')).toContain('OnActiveSec=45s');
    expect(readFileSync(timerPath, 'utf8')).not.toContain('OnBootSec=');
    expect(readFileSync(timerPath, 'utf8')).toContain('OnUnitActiveSec=120s');
    expect(runSystemctl).toHaveBeenNthCalledWith(1, ['daemon-reload']);
    expect(runSystemctl).toHaveBeenNthCalledWith(2, ['restart', 'amaran-circadian.timer']);
  });
});
