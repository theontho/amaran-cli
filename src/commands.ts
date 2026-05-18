import type { Command } from 'commander';
import type { CommandDeps } from './amaranLights.js';
import registerCircadianSimCommands from './commands/circadianSim.js';
import registerDeviceControlCommands from './commands/deviceControl.js';

// Expose a function to register commands on a commander program instance
export function registerCommands(program: Command, deps: CommandDeps) {
  registerDeviceControlCommands(program, deps);
  registerCircadianSimCommands(program, deps);
}

export default registerCommands;
