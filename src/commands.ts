import type { Command } from 'commander';
import chalk from 'chalk';
import type { Config } from './types';
import registerAutoCct from './commands/autoCct';
import registerCct from './commands/cct';
import registerColor from './commands/color';
import registerConfig from './commands/config';
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
  // Register config command first since other commands may depend on it
  const configDeps: CommandDeps = {
    ...deps,
    loadConfig: deps.loadConfig || (() => null),
    saveConfig: (config: Config, changes?: string[]) => {
      if (deps.saveWsUrl && config.wsUrl) {
        deps.saveWsUrl(config.wsUrl);
      }
      // Save the rest of the config
      const fs = require('node:fs');
      const path = require('node:path');
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
    }
  };
  
  // Register all commands
  registerConfig(program, configDeps);
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
