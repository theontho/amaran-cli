import type { Command } from 'commander';

import registerAutoCct from './commands/daylightSimulation/autoCct.js';
import registerGraphSchedule from './commands/daylightSimulation/graphSchedule.js';
import registerPrintSchedule from './commands/daylightSimulation/printSchedule.js';
import registerService from './commands/daylightSimulation/service.js';
import registerSimulateSchedule from './commands/daylightSimulation/simulateSchedule.js';
import registerCct from './commands/deviceControl/cct.js';
import registerColor from './commands/deviceControl/color.js';
import registerConfig from './commands/deviceControl/config.js';
import registerDiscover from './commands/deviceControl/discover.js';
import registerEffect from './commands/deviceControl/effect.js';
import registerFan from './commands/deviceControl/fan.js';
import registerGroup from './commands/deviceControl/group.js';
import registerHsi from './commands/deviceControl/hsi.js';
import registerInfo from './commands/deviceControl/info.js';
import registerIntensity from './commands/deviceControl/intensity.js';
import registerList from './commands/deviceControl/list.js';
import registerPower from './commands/deviceControl/power.js';
import registerPreset from './commands/deviceControl/preset.js';
import registerQuickshot from './commands/deviceControl/quickshot.js';
import registerScene from './commands/deviceControl/scene.js';
import registerStatus from './commands/deviceControl/status.js';
import type { CommandDeps } from './deviceControl/types.js';

// Expose a function to register commands on a commander program instance
export function registerCommands(program: Command, deps: CommandDeps) {
  // Register config command first
  registerConfig(program, deps);

  // Register all other commands
  registerAutoCct(program, deps);
  registerPrintSchedule(program, deps);
  registerGraphSchedule(program, deps);
  registerSimulateSchedule(program, deps);
  registerDiscover(program, deps);
  registerList(program, deps);
  registerPower(program, deps);
  registerIntensity(program, deps);
  registerCct(program, deps);
  registerHsi(program, deps);
  registerColor(program, deps);
  registerStatus(program, deps);
  registerService(program, deps);

  // New commands
  registerScene(program, deps);
  registerGroup(program, deps);
  registerPreset(program, deps);
  registerQuickshot(program, deps);
  registerFan(program, deps);
  registerEffect(program, deps);
  registerInfo(program, deps);
}

export default registerCommands;
