import chalk from 'chalk';
import type { Command } from 'commander';
import { discoverLocalWebSocket } from '../discovery';
import type { CommandDeps, CommandOptions } from '../types';

export function registerDiscover(program: Command, deps: CommandDeps) {
  const { asyncCommand, saveWsUrl } = deps;

  program
    .command('discover')
    .usage('[options]')
    .description('Discover local Amaran WebSocket endpoint')
    .option('-d, --debug', 'Enable debug output')
    .action(
      asyncCommand(async (options: CommandOptions) => {
        const res = await discoverLocalWebSocket('127.0.0.1', !!options.debug);
        if (res) {
          console.log(chalk.green(`Found WebSocket: ${res.url} (process: ${res.process})`));
          if (saveWsUrl) {
            saveWsUrl(res.url);
            console.log(chalk.green('Saved to configuration.'));
          }
        } else {
          console.log(chalk.yellow('No local Amaran WebSocket found via lsof'));
        }
      })
    );
}

export default registerDiscover;
