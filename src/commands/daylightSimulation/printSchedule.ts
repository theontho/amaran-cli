import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { Command } from 'commander';
import { CURVE_HELP_TEXT } from '../../daylightSimulation/constants.js';
import { ScheduleMaker } from '../../daylightSimulation/scheduleMaker.js';
import { textSchedule } from '../../daylightSimulation/textSchedule.js';
import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

type ScheduleCommandOptions = {
  lat?: string;
  lon?: string;
  date?: string;
  interval?: string;
  curve?: string;
  cloudCover?: string;
  precipitation?: string;
  privacyOff: boolean;
};

export function registerPrintSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('print')
    .description('Preview auto-cct schedule from sunrise to sunset')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-d, --date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option('-i, --interval <minutes>', 'Minutes between schedule entries (default: 30)', '30')
    .option('-C, --curve <curve>', CURVE_HELP_TEXT, 'all')
    .option('-c, --csv', 'Output as CSV format')
    .option('-o, --output <file>', 'Output result to a file')
    .option('--cloud-cover <value>', 'Cloud cover (0-1)')
    .option('--precipitation <type>', 'Precipitation type')
    .option('--privacy-off', 'Show full IP address and precise coordinates', false)
    .action(asyncCommand(handlePrintSchedule(deps)));
}

function handlePrintSchedule(deps: CommandDeps) {
  return async (options: CommandOptions & ScheduleCommandOptions & { csv?: boolean; output?: string }) => {
    const maker = new ScheduleMaker(deps);

    let schedule: Awaited<ReturnType<typeof maker.makeSchedule>>;
    try {
      schedule = await maker.makeSchedule({
        lat: options.lat,
        lon: options.lon,
        date: options.date,
        intervalMinutes: parseInt(options.interval ?? '30', 10),
        curves: options.curve,
        includeSpecialTimes: true,
        cloudCover: options.cloudCover,
        precipitation: options.precipitation,
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    const output = textSchedule(schedule, {
      csv: options.csv,
      privacyOff: options.privacyOff,
      interval: options.interval,
    });

    if (options.output) {
      try {
        const cleanOutput = textSchedule(schedule, {
          csv: options.csv,
          privacyOff: options.privacyOff,
          interval: options.interval,
          stripAnsi: true,
        });
        await writeFile(options.output, cleanOutput);
        console.log(chalk.green(`Schedule saved to ${options.output}`));
      } catch (error) {
        console.error(chalk.red(`Failed to write to file: ${(error as Error).message}`));
        process.exit(1);
      }
    } else {
      console.log(output);
    }
  };
}

export default registerPrintSchedule;
