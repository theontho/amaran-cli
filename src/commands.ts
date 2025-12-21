import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
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
import registerHsi from './commands/deviceControl/hsi.js';
import registerIntensity from './commands/deviceControl/intensity.js';
import registerList from './commands/deviceControl/list.js';
import registerPower from './commands/deviceControl/power.js';
import registerStatus from './commands/deviceControl/status.js';
import type { CommandDeps, Config } from './deviceControl/types.js';

// Expose a function to register commands on a commander program instance
export function registerCommands(program: Command, deps: CommandDeps) {
  // Register config command first since other commands may depend on it
  const configDeps: CommandDeps = {
    ...deps,
    loadConfig: deps.loadConfig || (() => null),
    saveConfig:
      deps.saveConfig ||
      ((config: Config, changes?: string[]) => {
        if (deps.saveWsUrl && config.wsUrl) {
          deps.saveWsUrl(config.wsUrl);
        }
        // Save the rest of the config
        const configPath = path.join(process.env.HOME || '', '.amaran-cli.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        if (changes && changes.length > 0) {
          console.log(chalk.green('Configuration saved successfully:'));
          changes.forEach((change: string) => {
            console.log(chalk.green(`  • ${change}`));
          });
        } else {
          console.log(chalk.green('Configuration saved successfully'));
        }
      }),
  };

  // Register all commands
  registerConfig(program, configDeps);
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
}

export default registerCommands;
