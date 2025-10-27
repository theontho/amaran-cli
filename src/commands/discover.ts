import chalk from 'chalk';
import type { Command } from 'commander';
import { discoverLocalWebSocket } from '../discovery';

export interface CommandDeps {
  createController: (wsUrl?: string, clientId?: string, debug?: boolean) => Promise<any>;
  findDevice: (controller: any, deviceQuery: string) => any;
  asyncCommand: (fn: (...args: any[]) => Promise<any>) => any;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => any;
}

export function registerDiscover(program: Command, deps: CommandDeps) {
  const { asyncCommand, saveWsUrl } = deps;

  program
    .command('discover')
    .description('Discover local Amaran WebSocket endpoint')
    .option('-d, --debug', 'Enable debug output')
    .action(
      asyncCommand(async (options: any) => {
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
