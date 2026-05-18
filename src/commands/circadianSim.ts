import type { Command } from 'commander';
import type { CommandDeps } from '../amaranLights.js';
import registerAutoCct from './daylightSimulation/autoCct.js';
import registerSchedule from './daylightSimulation/schedule.js';
import registerService from './daylightSimulation/service.js';
import registerWeather from './daylightSimulation/weather.js';

export function registerCircadianSimCommands(program: Command, deps: CommandDeps) {
  registerAutoCct(program, deps);
  registerSchedule(program, deps);
  registerService(program, deps);
  registerWeather(program, deps);
}

export default registerCircadianSimCommands;
