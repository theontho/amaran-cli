// Common types for the Amaran CLI
import type LightController from './lightControl';

export type { LightController };

export interface Device {
  node_id?: string;
  device_name?: string;
  name?: string;
  id?: string;
  [key: string]: unknown;
}

export type CommandCallback = (success: boolean, message: string, data?: unknown) => void;

export interface Config {
  wsUrl?: string;
  latitude?: number;
  longitude?: number;
  defaultCurve?: string;
  // Per-light intensity multiplier for auto-cct scaling, e.g. { "AAA-333": 0.8 }
  intensityMultiplier?: Record<string, number>;
  [key: string]: unknown;
}

export interface CommandDeps {
  createController: (wsUrl?: string, clientId?: string, debug?: boolean) => Promise<LightController>;
  findDevice: (controller: LightController, deviceQuery: string) => Device | null;
  asyncCommand: <T extends unknown[]>(fn: (...args: T) => Promise<void>) => (...args: T) => Promise<void>;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => Config | null;
  saveConfig?: (config: Config, changes?: string[]) => void;
}

export interface CommandOptions {
  url?: string;
  clientId?: string;
  debug?: boolean;
  intensity?: string;
  interval?: string;
  follow?: boolean;
  errors?: boolean;
  lat?: string;
  lon?: string;
  date?: string;
  curve?: string;
  [key: string]: unknown;
}
