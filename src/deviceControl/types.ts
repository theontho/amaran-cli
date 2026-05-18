// Common types for the Amaran CLI

export type LightBackend = 'websocket' | 'ble';

export type CommandType =
  | 'get_device_list'
  | 'get_fixture_list'
  | 'get_scene_list'
  | 'get_node_config'
  | 'get_sleep'
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
  | 'remove_from_group'
  | 'get_device_info'
  | 'update_firmware';

export interface Device {
  node_id?: string;
  device_name?: string;
  name?: string;
  id?: string;
  [key: string]: unknown;
}

export type CommandCallback = (success: boolean, message: string, data?: unknown) => void;

export interface NodeConfig {
  cct_support?: boolean;
  cct_min?: number;
  cct_max?: number;
  product_cct_min?: number;
  product_cct_max?: number;
  cct_extension_support?: boolean;
  cct_extension_min?: number;
  cct_extension_max?: number;
  cct_extension_enabled?: boolean;
  gm_support?: boolean;
  gm_min?: number;
  gm_max?: number;
  gm_v2_support?: boolean;
  hsi_support?: boolean;
  rgb_support?: boolean;
  advanced_hsi_support?: boolean;
  // State fields
  sleep?: boolean;
  intensity?: number;
  cct?: number;
  hue?: number;
  sat?: number;
  r?: number;
  g?: number;
  b?: number;
  x?: number;
  y?: number;
  work_mode?: string;
  fan_mode?: number;
  fan_speed?: number;
  effect_type?: string;
  effect_name?: string;
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
  backend?: LightBackend;
  wsUrl?: string;
  bleUrl?: string;
  bleApiKey?: string;
  clientId?: string;
  debug?: boolean;
  latitude?: number;
  longitude?: number;
  defaultCurve?: string;
  cctMin?: number;
  cctMax?: number;
  intensityMin?: number;
  intensityMax?: number;
  autoStartApp?: boolean;
  maxLux?: number | Record<string, number>;
  weather?: boolean;
  [key: string]: unknown;
}

export interface CommandDeps {
  createController(
    wsUrl?: string,
    clientId?: string,
    debug?: boolean,
    backend?: LightBackend
  ): Promise<LightController>;
  findDevice(controller: LightController, deviceQuery: string): Device | null;
  asyncCommand<T extends unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => Promise<void>;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => Config | null;
  saveConfig?: (config: Config, changes?: string[]) => void;
}

export interface CommandOptions {
  url?: string;
  backend?: LightBackend;
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
  privacyOff?: boolean;
  [key: string]: unknown;
}

export interface LightController {
  disconnect(): Promise<void>;
  getDevices(): Device[];
  getWebSocket?: () => unknown;
  getFixtureList(callback?: CommandCallback): void;
  getDeviceList(callback?: CommandCallback): void;
  getSceneList(callback?: CommandCallback): void;
  saveScene(name: string, callback?: CommandCallback): void;
  deleteScene(sceneId: string, callback?: CommandCallback): void;
  recallScene(sceneId: string, callback?: CommandCallback): void;
  updateScene(sceneId: string, name?: string, callback?: CommandCallback): void;
  getPresetList(callback?: CommandCallback): void;
  recallPreset(nodeId: string, presetId: string, callback?: CommandCallback): void;
  setPreset(nodeId: string, presetId: string, callback?: CommandCallback): void;
  getSystemEffectList(callback?: CommandCallback): void;
  getQuickshotList(callback?: CommandCallback): void;
  setQuickshot(quickshotId: string, callback?: CommandCallback): void;
  getGroupList(callback?: CommandCallback): void;
  createGroup(name: string, callback?: CommandCallback): void;
  deleteGroup(groupId: string, callback?: CommandCallback): void;
  addToGroup(groupId: string, nodeId: string, callback?: CommandCallback): void;
  removeFromGroup(groupId: string, nodeId: string, callback?: CommandCallback): void;
  getNodeConfig(nodeId: string, callback?: CommandCallback): void;
  turnLightOn(nodeId: string, callback?: CommandCallback): void;
  turnLightOff(nodeId: string, callback?: CommandCallback): void;
  getLightSleepStatus(nodeId: string, callback?: CommandCallback): void;
  toggleLight(nodeId: string, callback?: CommandCallback): void;
  getIntensity(nodeId: string, callback?: CommandCallback): void;
  setIntensity(nodeId: string, intensity: number, callback?: CommandCallback): void;
  incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback): void;
  getCCT(nodeId: string, callback?: CommandCallback): void;
  setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback): void;
  incrementCCT(nodeId: string, delta: number, intensity?: number, callback?: CommandCallback): void;
  getHSI(nodeId: string, callback?: CommandCallback): void;
  setHSI(
    nodeId: string,
    hue: number,
    sat: number,
    intensity: number,
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ): void;
  getRGB(nodeId: string, callback?: CommandCallback): void;
  setRGB(nodeId: string, r: number, g: number, b: number, intensity?: number, callback?: CommandCallback): void;
  getXY(nodeId: string, callback?: CommandCallback): void;
  setXY(nodeId: string, x: number, y: number, intensity?: number, callback?: CommandCallback): void;
  setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback): void;
  getSystemEffect(nodeId: string, callback?: CommandCallback): void;
  setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback): void;
  getEffect(nodeId: string, callback?: CommandCallback): void;
  setEffect(nodeId: string, effectName: string, args?: CommandArgs, callback?: CommandCallback): void;
  getFanMode(nodeId: string, callback?: CommandCallback): void;
  setFanMode(nodeId: string, mode: number, callback?: CommandCallback): void;
  getFanSpeed(nodeId: string, callback?: CommandCallback): void;
  setFanSpeed(nodeId: string, speed: number, callback?: CommandCallback): void;
  setEffectSpeed(nodeId: string, speed: number, callback?: CommandCallback): void;
  setEffectIntensity(nodeId: string, intensity: number, callback?: CommandCallback): void;
  getDeviceInfo(nodeId: string, callback?: CommandCallback): void;
  updateFirmware(nodeId: string, callback?: CommandCallback): void;
  setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback): Promise<void>;
  turnOnAllLights(callback?: CommandCallback): Promise<void>;
  turnOffAllLights(callback?: CommandCallback): Promise<void>;
  toggleAllLights(callback?: CommandCallback): Promise<void>;
  setIntensityForAllLights(intensity: number, callback?: CommandCallback): Promise<void>;
  incrementIntensityForAllLights(delta: number, callback?: CommandCallback): Promise<void>;
  incrementCCTForAllLights(delta: number, intensity?: number, callback?: CommandCallback): Promise<void>;
  setHSIForAllLights(
    hue: number,
    sat: number,
    intensity: number,
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ): Promise<void>;
  setColorForAllLights(color: string, intensity?: number, callback?: CommandCallback): Promise<void>;
  setSystemEffectForAllLights(effectType: string, intensity?: number, callback?: CommandCallback): Promise<void>;
}
