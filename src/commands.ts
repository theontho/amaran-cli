import type { Command } from 'commander';
import { registerAutoCct } from './commands/autoCct';
import { registerCct } from './commands/cct';
import { registerColor } from './commands/color';
import { registerDiscover } from './commands/discover';
import { registerHsi } from './commands/hsi';
import { registerIntensity } from './commands/intensity';
import { registerList } from './commands/list';
import { registerPower } from './commands/power';
import { registerSchedule } from './commands/schedule';
import { registerService } from './commands/service';
import { registerStatus } from './commands/status';

// Expose a function to register commands on a commander program instance
export function registerCommands(
  program: Command,
  deps: {
    createController: (wsUrl?: string, clientId?: string, debug?: boolean) => Promise<any>;
    findDevice: (controller: any, deviceQuery: string) => any;
    asyncCommand: (fn: (...args: any[]) => Promise<any>) => any;
    saveWsUrl?: (url: string) => void;
    loadConfig?: () => any;
  }
) {
  // Delegate registrations to feature modules (avoid megafile)
  registerAutoCct(program, deps as any);
  registerSchedule(program, deps as any);
  registerDiscover(program, deps as any);
  registerList(program, deps as any);
  registerPower(program, deps as any);
  registerIntensity(program, deps as any);
  registerCct(program, deps as any);
  registerHsi(program, deps as any);
  registerColor(program, deps as any);
  registerStatus(program, deps as any);
  registerService(program, deps as any);
}

export default registerCommands;
