import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { Command } from 'commander';
import { SPECIAL_TIME_CONFIG } from '../../daylightSimulation/constants.js';
import { ScheduleMaker } from '../../daylightSimulation/scheduleMaker.js';
import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

type ScheduleCommandOptions = {
  lat?: string;
  lon?: string;
  date?: string;
  interval?: string;
  curve?: string;
  private: boolean;
};

// Helper function to get color and emoji for a special time
function getSpecialTimeStyling(
  currentTime: Date,
  times: Record<string, Date | null | undefined>
): { color: (text: string) => string; emoji: string } {
  const isSpecialTime = (specialTime: Date | null | undefined) => {
    if (!specialTime || Number.isNaN(specialTime.getTime())) return false;
    return Math.abs(currentTime.getTime() - specialTime.getTime()) < 30000; // 30 seconds
  };

  for (const config of SPECIAL_TIME_CONFIG) {
    if (isSpecialTime(times[config.key])) {
      return { color: config.color, emoji: config.emoji };
    }
  }

  return { color: chalk.white, emoji: '' };
}

export function registerPrintSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('print-schedule')
    .description('Preview auto-cct schedule from sunrise to sunset')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-d, --date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option('-i, --interval <minutes>', 'Minutes between schedule entries (default: 30)', '30')
    .option(
      '-C, --curve <curve>',
      'Curve type (comma-separated list, or "all"). Available: hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight',
      'all'
    )
    .option('-c, --csv', 'Output as CSV format')
    .option('-o, --output <file>', 'Output result to a file')
    .option('-p, --no-private', 'Show full IP address and precise coordinates', true)
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
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    let outputBuffer = '';
    const print = (message: string) => {
      if (options.output) {
        // Strip ANSI codes
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional use for ANSI stripping
        const cleanMessage = message.replace(/\u001b\[\d+m/g, '');
        outputBuffer += `${cleanMessage}\n`;
      } else {
        console.log(message);
      }
    };

    if (options.csv) {
      // CSV Output
      const header = ['DateTime', 'Location', 'Event'];
      schedule.curves.forEach((c) => {
        header.push(`${c}_CCT`, `${c}_Intensity`);
      });
      print(header.join(','));

      for (const point of schedule.points) {
        const dateTimeStr = point.time.toISOString();
        const locationStr = `${schedule.lat},${schedule.lon}`;
        const eventName = point.eventName
          ? point.eventName
              .replace(/([A-Z])/g, ' $1')
              .replace(/^([a-z])/, (c) => c.toUpperCase())
              .trim()
          : '';
        const row = [dateTimeStr, `"${locationStr}"`, eventName];

        schedule.curves.forEach((curve) => {
          const val = point.values.get(curve);
          row.push(val?.cct.toString() ?? '', val ? (val.intensity / 10).toFixed(1) : '');
        });
        print(row.join(','));
      }
    } else {
      // Standard Output
      print(chalk.blue('\n═══════════════════════════════════════════════════════════'));
      print(chalk.blue('               Auto-CCT Schedule Preview'));
      print(chalk.blue('═══════════════════════════════════════════════════════════\n'));

      const formatCoordinate = (coord: number, isPrivate: boolean) => {
        return isPrivate ? `${Math.round(coord)}.XXXX` : coord.toFixed(4);
      };

      const formatSource = (src: string, isPrivate: boolean) => {
        if (!isPrivate || !src.includes('(')) return src;
        const ipMatch = src.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          const ipParts = ipMatch[1].split('.');
          ipParts[0] = 'XXX';
          ipParts[1] = 'XXX';
          ipParts[2] = 'XXX';
          return src.replace(ipMatch[1], ipParts.join('.'));
        }
        return src;
      };

      print(
        chalk.cyan(
          `Location: ${formatCoordinate(schedule.lat, options.private)}°, ${formatCoordinate(schedule.lon, options.private)}° (${formatSource(schedule.source, options.private)})`
        )
      );
      print(
        chalk.cyan(
          `Date: ${schedule.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
        )
      );
      print(chalk.cyan(`Interval: Every ${options.interval ?? '30'} minute${options.interval !== '1' ? 's' : ''}`));
      print(
        chalk.cyan(
          schedule.curves.length > 1
            ? `Curve: Multiple curves selected\n`
            : `Curve: ${schedule.curves[0].toLowerCase()}\n`
        )
      );

      const formatTitle = (key: string): string => {
        return key
          .replace(/([A-Z])/g, ' $1')
          .replace(/^([a-z])/, (c) => c.toUpperCase())
          .trim();
      };

      const allSpecialTimes = [
        ...SPECIAL_TIME_CONFIG.map((conf) => ({
          key: conf.key,
          emoji: conf.emoji,
          color: conf.color,
          time: schedule.times[conf.key],
        })),
        { key: 'nadir', emoji: 'NA', color: chalk.blue, time: schedule.times.nadir },
      ].filter((item) => item.time && !Number.isNaN(item.time.getTime()));

      const halfLength = Math.ceil(allSpecialTimes.length / 2);
      for (let i = 0; i < halfLength; i++) {
        const left = allSpecialTimes[i];
        const right = allSpecialTimes[i + halfLength];
        let line = '';
        if (left?.time) {
          const timeStr = left.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          line += left.color(`${`${left.emoji} ${formatTitle(left.key)}`.padEnd(20)}: ${timeStr}`);
        }
        if (right?.time) {
          const timeStr = right.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          line += `   ${right.color(`${`${right.emoji} ${formatTitle(right.key)}`.padEnd(20)}: ${timeStr}`)}`;
        }
        print(line);
      }
      print(chalk.blue('\n'));

      if (schedule.curves.length > 1) {
        const headers = [
          'Time',
          ...schedule.curves.map((c) => {
            const name = c.replace(/_/g, ' ');
            if (name.length > 12) {
              if (c === 'WIDER_MIDDLE_SMALL') return 'WM_SMALL';
              if (c === 'WIDER_MIDDLE_MEDIUM') return 'WM_MEDIUM';
              if (c === 'WIDER_MIDDLE_LARGE') return 'WM_LARGE';
              if (c === 'CIE_DAYLIGHT') return 'CIE';
              if (c === 'SUN_ALTITUDE') return 'SUN_ALT';
              if (c === 'PEREZ_DAYLIGHT') return 'PEREZ';
            }
            return name;
          }),
        ];
        const colWidths = [13, ...schedule.curves.map(() => 12)];
        const totalWidth = colWidths.reduce((a, b) => a + b, 0);

        let headerLine = '';
        headers.forEach((h, i) => {
          headerLine += h.padEnd(colWidths[i]);
        });
        print(chalk.blue('─'.repeat(totalWidth)));
        print(chalk.blue(headerLine));
        print(chalk.blue('─'.repeat(totalWidth)));

        for (const point of schedule.points) {
          const timeStr = point.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          const { color, emoji } = getSpecialTimeStyling(point.time, schedule.times);
          let rowLine = color(`${timeStr} ${emoji || '  '}  `);
          schedule.curves.forEach((curve, index) => {
            const val = point.values.get(curve);
            const valStr = val ? `${val.cct}K/${(val.intensity / 10).toFixed(0)}%` : '';
            rowLine += color(valStr.padEnd(colWidths[index + 1]));
          });
          print(rowLine);
        }
        print(chalk.blue(`${'─'.repeat(totalWidth)}\n`));
      } else {
        const singleCurveWidth = 31;
        print(chalk.blue('─'.repeat(singleCurveWidth)));
        print(chalk.blue('Time           CCT/Intensity'));
        print(chalk.blue('─'.repeat(singleCurveWidth)));

        for (const point of schedule.points) {
          const val = point.values.get(schedule.curves[0]);
          const timeStr = point.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          const valStr = val ? `${val.cct}K/${(val.intensity / 10).toFixed(0)}%`.padEnd(18) : '';
          const { color, emoji } = getSpecialTimeStyling(point.time, schedule.times);
          print(color(`${timeStr} ${emoji || '  '}    ${valStr}`));
        }
        print(chalk.blue(`${'─'.repeat(singleCurveWidth)}\n`));
      }
    }

    if (options.output) {
      try {
        await writeFile(options.output, outputBuffer);
        console.log(chalk.green(`Schedule saved to ${options.output}`));
      } catch (error) {
        console.error(chalk.red(`Failed to write to file: ${(error as Error).message}`));
        process.exit(1);
      }
    }
  };
}

export default registerPrintSchedule;
