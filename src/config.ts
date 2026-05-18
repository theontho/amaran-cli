import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const CONFIG_DIR_ENV = 'AMARAN_CLI_CONFIG_DIR';
export const APP_NAME = 'amaran-cli';

const legacyConfigPath = join(homedir(), '.amaran-cli.json');

const maxLuxSchema = z.union([
  z.number().positive(),
  z.record(z.string(), z.number().positive()).transform((value) => {
    const normalized: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value)) {
      const kelvin = Number(key);
      if (!Number.isFinite(kelvin)) {
        throw new Error(`Invalid maxLux color temperature: ${key}`);
      }
      normalized[String(kelvin)] = entry;
    }
    return normalized;
  }),
]);

export const ConfigSchema = z
  .object({
    backend: z.enum(['websocket', 'ble']).optional(),
    wsUrl: z.string().trim().min(1).optional(),
    bleUrl: z.string().trim().min(1).optional(),
    bleApiKey: z.string().optional(),
    clientId: z.string().trim().min(1).optional(),
    debug: z.boolean().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    defaultCurve: z.string().trim().min(1).optional(),
    cctMin: z.number().min(1000).max(20000).optional(),
    cctMax: z.number().min(1000).max(20000).optional(),
    intensityMin: z.number().min(0).max(100).optional(),
    intensityMax: z.number().min(0).max(100).optional(),
    autoStartApp: z.boolean().optional(),
    maxLux: maxLuxSchema.optional(),
    weather: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    if (config.cctMin !== undefined && config.cctMax !== undefined && config.cctMin > config.cctMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cctMin'], message: 'cctMin must be <= cctMax' });
    }
    if (
      config.intensityMin !== undefined &&
      config.intensityMax !== undefined &&
      config.intensityMin > config.intensityMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['intensityMin'],
        message: 'intensityMin must be <= intensityMax',
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function normalizeConfig(config: Config): Config {
  return ConfigSchema.parse(config);
}

export function getConfigDir(): string {
  const override = process.env[CONFIG_DIR_ENV];
  if (override) return override;

  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_NAME);
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP_NAME);
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), APP_NAME);
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

export function getLegacyConfigPath(): string {
  return legacyConfigPath;
}

export function getConfigReadPath(): string | null {
  return getReadableConfigPath();
}

export function loadConfig(): Config | null {
  const path = getReadableConfigPath();
  if (!path) return null;

  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return ConfigSchema.parse(data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config from ${path}: ${detail}`);
  }
}

export function saveConfig(config: Config): void {
  const path = getConfigPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const validated = ConfigSchema.parse(config);
  const tempPath = join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
    replaceFile(tempPath, path);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function getReadableConfigPath(): string | null {
  const configPath = getConfigPath();
  if (existsSync(configPath)) return configPath;
  if (!process.env[CONFIG_DIR_ENV] && existsSync(legacyConfigPath)) return legacyConfigPath;
  return null;
}

function replaceFile(sourcePath: string, targetPath: string): void {
  renameSync(sourcePath, targetPath);
}
