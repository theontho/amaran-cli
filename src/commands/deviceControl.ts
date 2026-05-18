import type { Command } from 'commander';
import type { CommandDeps } from '../amaranLights.js';
import registerCct from './deviceControl/cct.js';
import registerColor from './deviceControl/color.js';
import registerConfig from './deviceControl/config.js';
import registerDiscover from './deviceControl/discover.js';
import registerEffect from './deviceControl/effect.js';
import registerFan from './deviceControl/fan.js';
import registerGroup from './deviceControl/group.js';
import registerHsi from './deviceControl/hsi.js';
import registerInfo from './deviceControl/info.js';
import registerIntensity from './deviceControl/intensity.js';
import registerList from './deviceControl/list.js';
import registerPower from './deviceControl/power.js';
import registerPreset from './deviceControl/preset.js';
import registerQuickshot from './deviceControl/quickshot.js';
import registerScene from './deviceControl/scene.js';
import registerStatus from './deviceControl/status.js';

export function registerDeviceControlCommands(program: Command, deps: CommandDeps) {
  registerConfig(program, deps);
  registerDiscover(program, deps);
  registerList(program, deps);
  registerPower(program, deps);
  registerIntensity(program, deps);
  registerCct(program, deps);
  registerHsi(program, deps);
  registerColor(program, deps);
  registerStatus(program, deps);
  registerScene(program, deps);
  registerGroup(program, deps);
  registerPreset(program, deps);
  registerQuickshot(program, deps);
  registerFan(program, deps);
  registerEffect(program, deps);
  registerInfo(program, deps);
}

export default registerDeviceControlCommands;
