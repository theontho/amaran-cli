import { execFile } from 'node:child_process';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Config } from '../config.js';
import { calculateCurrentCCT } from './currentCct.js';

const execFileAsync = promisify(execFile);
const SERVICE_LABEL = 'com.hmmfn.amaran.circadian-service';

export interface CircadianSchedulePoint {
  time: string;
  cct: number;
  intensity: number;
  lightOutput?: number;
}

export interface CircadianDashboardStatus {
  generatedAt: string;
  service: {
    installed: boolean;
    loaded: boolean;
    active: boolean;
    healthy: boolean;
    intervalSeconds: number;
    curve?: string;
    weatherConfigured: boolean;
    lastRunAt?: string;
    lastTarget?: {
      cct: number;
      intensity: number;
    };
  };
  current?: {
    time: string;
    cct: number;
    intensity: number;
    curve: string;
    weatherActive: boolean;
    weatherSource: 'auto' | 'manual' | 'none';
    weatherDataSource?: string;
    cloudCover?: number;
    precipitation?: string;
  };
  schedule?: {
    date: string;
    timeZone: string;
    intervalMinutes: number;
    intensityLimit: number;
    points: CircadianSchedulePoint[];
  };
  calculationError?: string;
}

interface CircadianDashboardDeps {
  homeDir?: string;
  now?: Date;
  loadConfig: () => Config | null;
  isServiceLoaded?: () => Promise<boolean>;
}

export async function getCircadianDashboardStatus(deps: CircadianDashboardDeps): Promise<CircadianDashboardStatus> {
  const now = deps.now ?? new Date();
  const homeDir = deps.homeDir ?? homedir();
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
  const logPath = path.join(homeDir, 'Library', 'Logs', 'amaran-circadian-service.log');
  const installed = existsSync(plistPath);
  const plist = installed ? readFileSync(plistPath, 'utf8') : '';
  const args = parseProgramArguments(plist);
  const intervalSeconds = parseInteger(plist, 'StartInterval') ?? 60;
  const loaded = installed && (await (deps.isServiceLoaded ?? isServiceLoaded)());
  const latest = existsSync(logPath) ? parseLatestTarget(readTail(logPath)) : undefined;
  const recent =
    latest !== undefined &&
    now.getTime() - new Date(latest.time).getTime() <= Math.max(intervalSeconds * 3 * 1000, 180_000);
  const config = deps.loadConfig() ?? {};
  const curve = optionValue(args, '--curve') ?? config.defaultCurve;
  const weatherConfigured = args.includes('--weather') || config.weather === true;
  const result: CircadianDashboardStatus = {
    generatedAt: now.toISOString(),
    service: {
      installed,
      loaded,
      active: loaded,
      healthy: loaded && recent,
      intervalSeconds,
      curve,
      weatherConfigured,
      ...(latest
        ? {
            lastRunAt: latest.time,
            lastTarget: { cct: latest.cct, intensity: latest.intensity },
          }
        : {}),
    },
  };

  try {
    const current = await calculateCurrentCCT(
      {
        time: now,
        curve,
        weather: weatherConfigured,
      },
      { loadConfig: () => config }
    );
    result.current = {
      time: now.toISOString(),
      cct: current.result.cct,
      intensity: current.percent,
      curve: current.curveType.toLowerCase().replaceAll('_', '-'),
      weatherActive: current.weatherSource !== 'none',
      weatherSource: current.weatherSource,
      weatherDataSource: current.weatherDataSource,
      cloudCover: current.weatherOptions?.cloudCover,
      precipitation: current.weatherOptions?.precipitation,
    };

    const intervalMinutes = 15;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const points: CircadianSchedulePoint[] = [];
    for (let time = start.getTime(); time <= end.getTime(); time += intervalMinutes * 60_000) {
      const calculation = await calculateCurrentCCT(
        {
          lat: current.lat,
          lon: current.lon,
          time: new Date(time),
          curve,
          weather: false,
          cloudCover: current.weatherOptions?.cloudCover,
          precipitation: current.weatherOptions?.precipitation,
        },
        { loadConfig: () => config }
      );
      points.push({
        time: new Date(time).toISOString(),
        cct: calculation.result.cct,
        intensity: calculation.percent,
        lightOutput: calculation.result.lightOutput,
      });
    }
    result.schedule = {
      date: localDate(start),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      intervalMinutes,
      intensityLimit: config.intensityMax ?? 100,
      points,
    };
  } catch (error) {
    result.calculationError = (error as Error).message;
  }

  return result;
}

async function isServiceLoaded(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    const { stdout } = await execFileAsync('launchctl', ['list']);
    return stdout.includes(SERVICE_LABEL);
  } catch {
    return false;
  }
}

function parseProgramArguments(plist: string): string[] {
  const block = /<key>ProgramArguments<\/key>\s*<array>(.*?)<\/array>/s.exec(plist)?.[1] ?? '';
  return [...block.matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1]);
}

function parseInteger(plist: string, key: string): number | undefined {
  const value = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(plist)?.[1];
  return value === undefined ? undefined : Number(value);
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseLatestTarget(log: string): { time: string; cct: number; intensity: number } | undefined {
  const pattern = /^\[([^\]]+)\]\s+Setting CCT to (\d+)K at ([\d.]+)% for active lights$/gm;
  let latest: RegExpExecArray | null = null;
  for (let match = pattern.exec(log); match; match = pattern.exec(log)) latest = match;
  if (!latest) return undefined;
  return {
    time: latest[1],
    cct: Number(latest[2]),
    intensity: Number(latest[3]),
  };
}

function readTail(file: string, maximum = 256 * 1024): string {
  const descriptor = openSync(file, 'r');
  try {
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, maximum);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
