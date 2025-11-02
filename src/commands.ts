import type { Command } from 'commander';
import registerAutoCct from './commands/autoCct';
import registerCct from './commands/cct';
import registerColor from './commands/color';
import registerDiscover from './commands/discover';
import registerHsi from './commands/hsi';
import registerIntensity from './commands/intensity';
import registerList from './commands/list';
import registerPower from './commands/power';
import registerSchedule from './commands/schedule';
import registerService from './commands/service';
import registerSimulateSchedule from './commands/simulateSchedule';
import registerStatus from './commands/status';
import type { CommandDeps } from './types';

// Expose a function to register commands on a commander program instance
export function registerCommands(program: Command, deps: CommandDeps) {
  // Delegate registrations to feature modules (avoid megafile)
  registerAutoCct(program, deps);
  registerSchedule(program, deps);
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
}

export default registerCommands;
