import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { graphSchedule } from '../../daylightSimulation/graphSchedule.js';
import { ScheduleMaker } from '../../daylightSimulation/scheduleMaker.js';
import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

type GraphCommandOptions = {
  lat?: string;
  lon?: string;
  date?: string;
  curve?: string;
  width?: string;
  height?: string;
  output?: string;
  metrics?: string;
};

export function registerGraphSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('graph-schedule')
    .description('Generate a graph of the auto-cct schedule')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-d, --date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option(
      '-C, --curve <curve>',
      'Curve type (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight)'
    )
    .option('-o, --output <filename>', 'Output filename (default: schedule-<date>.png)')
    .option('-W, --width <width>', 'Image width in pixels (default: 1200)', '1200')
    .option('-H, --height <height>', 'Image height in pixels (default: 600)', '600')
    .option('-m, --metrics <type>', 'Metrics to graph: cct, intensity, or both (default: both)', 'both')
    .action(asyncCommand(handleGraphSchedule(deps)));
}

function handleGraphSchedule(deps: CommandDeps) {
  return async (options: CommandOptions & GraphCommandOptions) => {
    const maker = new ScheduleMaker(deps);

    let schedule: Awaited<ReturnType<typeof maker.makeSchedule>>;
    try {
      // For graphing, we want minute-by-minute granularity for a smooth curve
      schedule = await maker.makeSchedule({
        lat: options.lat,
        lon: options.lon,
        date: options.date,
        intervalMinutes: 1,
        curves: options.curve,
        includeSpecialTimes: false, // Cleaner graph with regular intervals
        bufferMinutes: 30,
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    try {
      const buffer = await graphSchedule(schedule, {
        width: options.width ? parseInt(options.width, 10) : undefined,
        height: options.height ? parseInt(options.height, 10) : undefined,
        metrics: options.metrics as 'cct' | 'intensity' | 'both',
      });

      let filename = options.output;
      if (!filename) {
        const dateStr = schedule.date.toISOString().split('T')[0];
        filename = `schedule-${dateStr}.png`;
      }
      if (!filename.toLowerCase().endsWith('.png')) filename += '.png';
      const outputPath = path.resolve(process.cwd(), filename);
      fs.writeFileSync(outputPath, buffer);
      console.log(chalk.green(`Graph saved to ${outputPath}`));
    } catch (error) {
      console.error(chalk.red('Error generating graph:'), error);
      process.exit(1);
    }
  };
}

export default registerGraphSchedule;
