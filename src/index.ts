export * as amaranLights from './amaranLights.js';
export * as circadianSim from './circadianSim.js';
export { registerCommands } from './commands.js';
export type { Config as CliConfig } from './config.js';
export {
  APP_NAME,
  CONFIG_DIR_ENV,
  ConfigSchema,
  getConfigDir,
  getConfigPath,
  getConfigReadPath,
  getLegacyConfigPath,
  loadConfig,
  normalizeConfig,
  saveConfig,
} from './config.js';
export type { AppConfig } from './deviceControl/autostart.js';
export { handleAutostart, isAmaranAppRunning, startAmaranApp } from './deviceControl/autostart.js';
export type { DiscoveryResult } from './deviceControl/discovery.js';
export { discoverLocalWebSocket, parseAmaranPorts } from './deviceControl/discovery.js';
export { default, default as LightController } from './deviceControl/lightControl.js';
export { enableGlobalTimestamps } from './deviceControl/logging.js';
export type {
  Command,
  CommandArgs,
  CommandCallback,
  CommandDeps,
  CommandOptions,
  CommandType,
  Config as DeviceControlConfig,
  Device,
  NodeConfig,
} from './deviceControl/types.js';
