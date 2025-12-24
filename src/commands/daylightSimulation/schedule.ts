import type { Command } from 'commander';
import type { CommandDeps } from '../../deviceControl/types.js';
import registerGraphSchedule from './graphSchedule.js';
import registerPrintSchedule from './printSchedule.js';
import registerSimulateSchedule from './simulateSchedule.js';

export function registerSchedule(program: Command, deps: CommandDeps) {
  const schedule = program.command('schedule').description('Commands for viewing and simulating light schedules');

  registerPrintSchedule(schedule, deps);
  registerGraphSchedule(schedule, deps);
  registerSimulateSchedule(schedule, deps);
}

export default registerSchedule;
