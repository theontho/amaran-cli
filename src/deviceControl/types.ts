// Common types for the Amaran CLI
import type LightController from './lightControl.js';

export type { LightController };

export type CommandType =
  | 'get_device_list'
  | 'get_fixture_list'
  | 'get_scene_list'
  | 'get_node_config'
  | 'get_sleep'
  | 'get_protocol_versions'
  | 'get_device_info'
  | 'get_firmware_version'
  | 'check_for_updates'
  | 'update_firmware'
  | 'get_intensity'
  | 'get_cct'
  | 'get_hsi'
  | 'get_rgb'
  | 'get_xy'
  | 'get_system_effect'
  | 'get_effect'
  | 'get_fan_mode'
  | 'get_fan_speed'
  | 'get_preset_list'
  | 'get_system_effect_list'
  | 'get_quickshot_list'
  | 'get_group_list'
  | 'set_sleep'
  | 'toggle_sleep'
  | 'set_intensity'
  | 'increase_intensity'
  | 'increment_intensity'
  | 'set_cct'
  | 'increase_cct'
  | 'increment_cct'
  | 'set_hsi'
  | 'set_color'
  | 'set_rgb'
  | 'set_xy'
  | 'set_system_effect'
  | 'set_effect'
  | 'set_effect_speed'
  | 'set_effect_intensity'
  | 'set_fan_mode'
  | 'set_fan_speed'
  | 'set_preset'
  | 'recall_preset'
  | 'set_quickshot'
  | 'save_scene'
  | 'delete_scene'
  | 'recall_scene'
  | 'update_scene'
  | 'create_group'
  | 'delete_group'
  | 'add_to_group'
  | 'remove_from_group';

export interface Device {
  node_id?: string;
  device_name?: string;
  name?: string;
  id?: string;
  [key: string]: unknown;
}

export type CommandCallback = (success: boolean, message: string, data?: unknown) => void;

export interface NodeConfig {
  [key: string]: unknown;
}

export interface CommandArgs {
  [key: string]: unknown;
}

export interface Command {
  version: number;
  client_id: string;
  type: CommandType;
  action?: string;
  node_id?: string;
  args?: CommandArgs;
  request?: { type: string };
}

export interface Config {
  wsUrl?: string;
  latitude?: number;
  longitude?: number;
  defaultCurve?: string;
  // Per-light intensity multiplier for auto-cct scaling, e.g. { "AAA-333": 0.8 }
  intensityMultiplier?: Record<string, number>;
  maxLux?: number;
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
