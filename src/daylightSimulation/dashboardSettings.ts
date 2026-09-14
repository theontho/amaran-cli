import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { type Config, ConfigSchema } from '../config.js';
import { parseCurveType } from './cctUtil.js';
import { CurveType } from './types.js';

const execFileAsync = promisify(execFile);
const SERVICE_LABEL = 'com.hmmfn.amaran.circadian-service';
const SYSTEMD_SERVICE = 'amaran-circadian.service';
const SYSTEMD_TIMER = 'amaran-circadian.timer';

const CircadianSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalSeconds: z.number().int().min(10).max(86400).optional(),
    curve: z.string().trim().min(1).optional(),
    weather: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    cctMin: z.number().min(1000).max(20000).optional(),
    cctMax: z.number().min(1000).max(20000).optional(),
    intensityMin: z.number().min(0).max(100).optional(),
    intensityMax: z.number().min(0).max(100).optional(),
  })
  .strict();

export type CircadianSettingsUpdate = z.infer<typeof CircadianSettingsSchema>;

interface CircadianSettingsDeps {
  homeDir?: string;
  platform?: NodeJS.Platform;
  loadConfig: () => Config | null;
  saveConfig: (config: Config) => void;
  runLaunchctl?: (args: string[]) => Promise<void>;
  isServiceLoaded?: () => Promise<boolean>;
  runSystemctl?: (args: string[]) => Promise<void>;
  isSystemdTimerActive?: () => Promise<boolean>;
}

export async function updateCircadianDashboardSettings(value: unknown, deps: CircadianSettingsDeps): Promise<void> {
  const update = CircadianSettingsSchema.parse(value);
  const config: Record<string, unknown> = { ...(deps.loadConfig() ?? {}) };
  if (update.curve !== undefined) {
    const parsed = parseCurveType(update.curve);
    config.defaultCurve = CurveType[parsed];
  }
  for (const key of ['weather', 'cctMin', 'cctMax', 'intensityMin', 'intensityMax'] as const) {
    if (update[key] !== undefined) config[key] = update[key];
  }
  for (const key of ['latitude', 'longitude'] as const) {
    if (update[key] === null) delete config[key];
    else if (update[key] !== undefined) config[key] = update[key];
  }
  if ((typeof config.latitude === 'number') !== (typeof config.longitude === 'number')) {
    throw new Error('Latitude and longitude must both be set or both be automatic');
  }
  deps.saveConfig(ConfigSchema.parse(config));

  const homeDir = deps.homeDir ?? homedir();
  const platform = deps.platform ?? process.platform;
  if (platform === 'linux') {
    await updateSystemdSettings(update, config, homeDir, deps);
    return;
  }
  if (platform !== 'darwin' && !deps.runLaunchctl) return;
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  if (!existsSync(plistPath)) return;

  let plist = readFileSync(plistPath, 'utf8');
  const configuredCurve = typeof config.defaultCurve === 'string' ? config.defaultCurve : CurveType.CIE_DAYLIGHT;
  const intervalSeconds = update.intervalSeconds ?? parseInteger(plist, 'StartInterval') ?? 60;
  const nextPlist = plist
    .replace(/(<string>--curve<\/string>\s*<string>)[^<]*(<\/string>)/, `$1${escapeXmlText(configuredCurve)}$2`)
    .replace(/(<key>StartInterval<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${intervalSeconds}$2`);
  const changed = nextPlist !== plist;
  if (changed) {
    writeFileSync(plistPath, nextPlist);
    plist = nextPlist;
  }

  const isLoaded = await (deps.isServiceLoaded ?? serviceLoaded)();
  const enabled = update.enabled ?? isLoaded;
  const runLaunchctl = deps.runLaunchctl ?? launchctl;
  if (isLoaded && !enabled) await runLaunchctl(['unload', '-w', plistPath]);
  else if (isLoaded && changed) await runLaunchctl(['unload', plistPath]);
  if (enabled && !isLoaded) await runLaunchctl(['load', '-w', plistPath]);
  else if (enabled && changed) await runLaunchctl(['load', plistPath]);
}

async function updateSystemdSettings(
  update: CircadianSettingsUpdate,
  config: Record<string, unknown>,
  homeDir: string,
  deps: CircadianSettingsDeps
): Promise<void> {
  const unitDirectory = path.join(homeDir, '.config', 'systemd', 'user');
  const servicePath = path.join(unitDirectory, SYSTEMD_SERVICE);
  const timerPath = path.join(unitDirectory, SYSTEMD_TIMER);
  if (!existsSync(servicePath) || !existsSync(timerPath)) return;

  const configuredCurve = typeof config.defaultCurve === 'string' ? config.defaultCurve : CurveType.CIE_DAYLIGHT;
  const service = readFileSync(servicePath, 'utf8');
  const timer = readFileSync(timerPath, 'utf8');
  const intervalSeconds = update.intervalSeconds ?? parseSystemdInterval(timer) ?? 60;
  const nextService = service.replace(/(--curve\s+)\S+/, `$1${configuredCurve}`);
  const nextTimer = timer.replace(/^(OnUnitActiveSec=).+$/m, `$1${intervalSeconds}s`);
  const changed = nextService !== service || nextTimer !== timer;
  if (nextService !== service) writeFileSync(servicePath, nextService);
  if (nextTimer !== timer) writeFileSync(timerPath, nextTimer);

  const isActive = await (deps.isSystemdTimerActive ?? systemdTimerActive)();
  const enabled = update.enabled ?? isActive;
  const runSystemctl = deps.runSystemctl ?? systemctl;
  if (changed) await runSystemctl(['daemon-reload']);
  if (isActive && !enabled) await runSystemctl(['disable', '--now', SYSTEMD_TIMER]);
  else if (enabled && !isActive) await runSystemctl(['enable', '--now', SYSTEMD_TIMER]);
  else if (enabled && changed) await runSystemctl(['restart', SYSTEMD_TIMER]);
}

async function serviceLoaded(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('launchctl', ['list']);
    return stdout.includes(SERVICE_LABEL);
  } catch {
    return false;
  }
}

async function launchctl(args: string[]): Promise<void> {
  await execFileAsync('launchctl', args);
}

async function systemdTimerActive(): Promise<boolean> {
  try {
    await execFileAsync('systemctl', ['--user', 'is-active', '--quiet', SYSTEMD_TIMER]);
    return true;
  } catch {
    return false;
  }
}

async function systemctl(args: string[]): Promise<void> {
  await execFileAsync('systemctl', ['--user', ...args]);
}

function parseInteger(source: string, key: string): number | undefined {
  const match = source.match(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`));
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseSystemdInterval(source: string): number | undefined {
  const value = /^OnUnitActiveSec=(\d+)s$/m.exec(source)?.[1];
  return value === undefined ? undefined : Number(value);
}

function escapeXmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
