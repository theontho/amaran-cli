import { writeFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { Command } from 'commander';
import { SPECIAL_TIME_CONFIG } from '../constants.js';
import type { CommandDeps, CommandOptions } from '../types.js';

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
  const { loadConfig } = deps;

  return async (options: CommandOptions & ScheduleCommandOptions & { csv?: boolean; output?: string }) => {
    const { getLocationFromIP } = await import('../geoipUtil.js');
    const { calculateCCT, CurveType, parseCurveType } = await import('../cctUtil.js');
    const SunCalc = (await import('suncalc')).default;
    const { getTimes } = SunCalc;

    let outputBuffer = '';
    const print = (message: string) => {
      if (options.output) {
        // Strip ANSI codes
        // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional use for ANSI stripping
        const cleanMessage = message.replace(/\x1b\[\d+m/g, '');
        outputBuffer += `${cleanMessage}\n`;
      } else {
        console.log(message);
      }
    };

    let lat: number | undefined;
    let lon: number | undefined;
    let date: Date = new Date();
    let source = '';

    if (options.date) {
      date = new Date(options.date);
      if (Number.isNaN(date.getTime())) {
        console.error(chalk.red('Invalid date format. Use ISO format (e.g., 2025-10-26)'));
        process.exit(1);
      }
    }

    // Validate curve option
    let curveTypes: (keyof typeof CurveType)[] = ['HANN'];
    const curveOption = options.curve?.toLowerCase() || '';

    const allCurveTypesOrdered: (keyof typeof CurveType)[] = [
      'HANN',
      'WIDER_MIDDLE_SMALL',
      'WIDER_MIDDLE_MEDIUM',
      'WIDER_MIDDLE_LARGE',
      'CIE_DAYLIGHT',
      'SUN_ALTITUDE',
      'PEREZ_DAYLIGHT',
    ];

    if (curveOption === 'all') {
      curveTypes = [...allCurveTypesOrdered];
    } else if (curveOption) {
      try {
        const parts = curveOption.split(',').map((s) => s.trim());
        const parsedList: (keyof typeof CurveType)[] = [];
        for (const part of parts) {
          if (part === 'all') {
            parsedList.push(...allCurveTypesOrdered);
          } else {
            parsedList.push(parseCurveType(part));
          }
        }
        // Dedup and sort according to standard order
        const unique = new Set(parsedList);
        curveTypes = allCurveTypesOrdered.filter((c) => unique.has(c));
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    } else if (loadConfig) {
      const config = loadConfig();
      if (config?.defaultCurve) {
        try {
          const parsed = parseCurveType(config.defaultCurve);
          curveTypes = [parsed];
        } catch (_) {
          // Ignore invalid default curve
        }
        if (!options.csv) {
          console.warn(
            chalk.yellow(`Warning: Invalid default curve in config: ${config.defaultCurve}. Showing all curves.`)
          );
        }
        curveTypes = [...allCurveTypesOrdered];
      } else {
        curveTypes = [...allCurveTypesOrdered];
      }
    } else {
      curveTypes = [...allCurveTypesOrdered];
    }

    if (options.lat !== undefined && options.lon !== undefined) {
      lat = parseFloat(options.lat);
      lon = parseFloat(options.lon);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        console.error(chalk.red('Latitude must be between -90 and 90'));
        process.exit(1);
      }
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        console.error(chalk.red('Longitude must be between -180 and 180'));
        process.exit(1);
      }
      source = 'manual';
    } else if (loadConfig) {
      const config = loadConfig();
      if (config && typeof config.latitude === 'number' && typeof config.longitude === 'number') {
        lat = config.latitude;
        lon = config.longitude;
        source = 'config';
      }
    }

    if (lat === undefined || lon === undefined) {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        const location = getLocationFromIP(data.ip);
        if (!location || !location.ll) {
          console.error(chalk.red('Could not determine location. Use --lat and --lon to specify manually.'));
          process.exit(1);
        }
        [lat, lon] = location.ll;
        source = `geoip (${data.ip})`;
      } catch (_err) {
        console.error(chalk.red('Could not determine location. Use --lat and --lon to specify manually.'));
        process.exit(1);
      }
    }

    const interval = parseInt(options.interval ?? '30', 10);
    if (Number.isNaN(interval) || interval < 1) {
      console.error(chalk.red('Interval must be a positive number of minutes'));
      process.exit(1);
    }

    const times = getTimes(date, lat, lon);
    const sunrise = times.sunrise;
    const sunset = times.sunset;
    const solarNoon = times.solarNoon;
    const dawn = times.dawn;
    const dusk = times.dusk;
    const nadir = times.nadir;
    const nauticalDawn = times.nauticalDawn;
    const nauticalDusk = times.nauticalDusk;
    const sunriseEnd = times.sunriseEnd;
    const sunsetStart = times.sunsetStart;
    const goldenHour = times.goldenHour;
    const goldenHourEnd = times.goldenHourEnd;
    const night = times.night;
    const nightEnd = times.nightEnd;

    if (!sunrise || !sunset || Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
      console.error(chalk.red('Could not calculate sunrise/sunset for this location and date'));
      process.exit(1);
    }

    // Calculations common to both views
    const allSpecialTimesArr = [
      nightEnd,
      nauticalDawn,
      dawn,
      sunrise,
      sunriseEnd,
      goldenHourEnd,
      solarNoon,
      goldenHour,
      sunsetStart,
      sunset,
      nauticalDusk,
      dusk,
      night,
    ]
      .filter((time) => time && !Number.isNaN(time.getTime()))
      .map((time) => (time as Date).getTime());

    if (allSpecialTimesArr.length === 0) {
      console.error(chalk.red('Could not calculate special times for this location and date'));
      process.exit(1);
    }

    const minTime = new Date(Math.min(...allSpecialTimesArr));
    const maxTime = new Date(Math.max(...allSpecialTimesArr));
    const bufferMs = interval * 60 * 1000; // 1 interval unit on each side

    const startTime = new Date(minTime.getTime() - bufferMs);
    const endTime = new Date(maxTime.getTime() + bufferMs);
    const intervalMs = interval * 60 * 1000;

    // Create array of all times to display: regular intervals + special times
    const allTimes: Date[] = [];

    // Add regular interval times
    let intervalTime = new Date(startTime);
    while (intervalTime <= endTime) {
      allTimes.push(new Date(intervalTime));
      intervalTime = new Date(intervalTime.getTime() + intervalMs);
    }

    // Add special times at their exact moments
    const specialTimes = [
      nightEnd,
      nauticalDawn,
      dawn,
      sunrise,
      sunriseEnd,
      goldenHourEnd,
      solarNoon,
      goldenHour,
      sunsetStart,
      sunset,
      nauticalDusk,
      dusk,
      night,
    ].filter((time) => time && !Number.isNaN(time.getTime())) as Date[];

    allTimes.push(...specialTimes);

    // Sort all times and remove duplicates (within 30 seconds tolerance)
    allTimes.sort((a, b) => a.getTime() - b.getTime());
    const uniqueTimes: Date[] = [];
    const duplicateThresholdMs = 30 * 1000; // 30 seconds

    for (const time of allTimes) {
      if (
        uniqueTimes.length === 0 ||
        time.getTime() - uniqueTimes[uniqueTimes.length - 1].getTime() > duplicateThresholdMs
      ) {
        uniqueTimes.push(time);
      }
    }
    // Respect user-configured bounds if provided
    const cfg: Record<string, unknown> = typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {};
    const cctMinRaw = cfg.cctMin;
    const cctMaxRaw = cfg.cctMax;
    const iMinRaw = cfg.intensityMin;
    const iMaxRaw = cfg.intensityMax;
    const hasCctBounds = typeof cctMinRaw === 'number' || typeof cctMaxRaw === 'number';
    const hasIntensityBounds = typeof iMinRaw === 'number' || typeof iMaxRaw === 'number';

    const timesObj = {
      nightEnd,
      nauticalDawn,
      dawn,
      sunrise,
      sunriseEnd,
      goldenHourEnd,
      solarNoon,
      goldenHour,
      sunsetStart,
      sunset,
      nauticalDusk,
      dusk,
      night,
      nadir,
    };

    if (options.csv) {
      // CSV Output
      const header = ['DateTime', 'Location', 'Event'];
      curveTypes.forEach((c) => {
        header.push(`${c}_CCT`, `${c}_Intensity`);
      });
      print(header.join(','));

      const getEventName = (t: Date) => {
        for (const [key, val] of Object.entries(timesObj)) {
          if (val && Math.abs(t.getTime() - val.getTime()) < 30000) {
            return key
              .replace(/([A-Z])/g, ' $1')
              .replace(/^([a-z])/, (c) => c.toUpperCase())
              .trim();
          }
        }
        return '';
      };

      for (const currentTime of uniqueTimes) {
        const dateTimeStr = currentTime.toISOString();
        const locationStr = `${lat},${lon}`;
        const event = getEventName(currentTime);
        const row = [dateTimeStr, `"${locationStr}"`, event];

        curveTypes.forEach((curve) => {
          const result =
            hasCctBounds || hasIntensityBounds
              ? calculateCCT(
                  lat,
                  lon,
                  currentTime,
                  {
                    cctMinK: typeof cctMinRaw === 'number' ? cctMinRaw : undefined,
                    cctMaxK: typeof cctMaxRaw === 'number' ? cctMaxRaw : undefined,
                    intensityMinPct: typeof iMinRaw === 'number' ? iMinRaw : undefined,
                    intensityMaxPct: typeof iMaxRaw === 'number' ? iMaxRaw : undefined,
                  },
                  CurveType[curve]
                )
              : calculateCCT(lat, lon, currentTime, undefined, CurveType[curve]);

          row.push(result.cct.toString(), `${(result.intensity / 10).toFixed(1)}`);
        });
        print(row.join(','));
      }
    } else {
      // Standard Output
      print(chalk.blue('\n═══════════════════════════════════════════════════════════'));
      print(chalk.blue('               Auto-CCT Schedule Preview'));
      print(chalk.blue('═══════════════════════════════════════════════════════════\n'));

      // Format location based on private mode
      const formatCoordinate = (coord: number, isPrivate: boolean) => {
        return isPrivate ? `${Math.round(coord)}.XXXX` : coord.toFixed(4);
      };

      const formatSource = (src: string, isPrivate: boolean) => {
        if (!isPrivate || !src.includes('(')) return src;

        // Hide IP address parts
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
          `Location: ${formatCoordinate(lat as number, options.private)}°, ${formatCoordinate(lon as number, options.private)}° ` +
            `(${formatSource(source, options.private)})`
        )
      );
      print(
        chalk.cyan(
          `Date: ${date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
        )
      );
      print(chalk.cyan(`Interval: Every ${interval} minute${interval !== 1 ? 's' : ''}`));
      if (curveTypes.length > 1) {
        print(chalk.cyan(`Curve: Multiple curves selected\n`));
      } else {
        print(chalk.cyan(`Curve: ${curveTypes[0].toLowerCase()}\n`));
      }

      // Display all special times
      const formatTitle = (key: string): string => {
        return key
          .replace(/([A-Z])/g, ' $1') // Add space before capital letters
          .replace(/^([a-z])/, (c) => c.toUpperCase()) // Capitalize first letter
          .trim();
      };

      // Create array of all special times including nadir
      const allSpecialTimes = [
        ...SPECIAL_TIME_CONFIG.map((config) => ({
          key: config.key,
          emoji: config.emoji,
          color: config.color,
          time: timesObj[config.key as keyof typeof timesObj],
        })),
        {
          key: 'nadir',
          emoji: 'NA',
          color: chalk.blue,
          time: timesObj.nadir,
        },
      ].filter((item) => item.time && !Number.isNaN(item.time.getTime()));

      // Display in 2 columns
      const halfLength = Math.ceil(allSpecialTimes.length / 2);
      for (let i = 0; i < halfLength; i++) {
        const left = allSpecialTimes[i];
        const right = allSpecialTimes[i + halfLength];

        let line = '';
        if (left?.time) {
          const timeStr = left.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          const label = `${left.emoji} ${formatTitle(left.key)}`.padEnd(20);
          line += left.color(`${label}: ${timeStr}`);
        }

        if (right?.time) {
          const timeStr = right.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          const label = `${right.emoji} ${formatTitle(right.key)}`.padEnd(20);
          line += `   ${right.color(`${label}: ${timeStr}`)}`;
        }

        print(line);
      }

      print(chalk.blue('\n'));

      // Calculate table widths
      const multiCurveColWidths = [13, ...curveTypes.map(() => 12)];
      const _totalWidthVal = multiCurveColWidths.reduce((a, b) => a + b, 0);
      const singleCurveWidth = 13 + 18; // Time width + CCT/Intensity width

      if (curveTypes.length > 1) {
        // Show multiple curves in one table
        const headers = [
          'Time',
          ...curveTypes.map((c) => {
            // Abbreviate headers if needed or just use names
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

        const colWidths = [13, ...curveTypes.map(() => 12)];
        const totalWidth = colWidths.reduce((a, b) => a + b, 0);

        // Print header
        let headerLine = '';
        headers.forEach((header, i) => {
          headerLine += header.padEnd(colWidths[i]);
        });

        print(chalk.blue('─'.repeat(totalWidth)));
        print(chalk.blue(headerLine));
        print(chalk.blue('─'.repeat(totalWidth)));

        for (const currentTime of uniqueTimes) {
          const timeStr = currentTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          });

          const { color, emoji } = getSpecialTimeStyling(currentTime, timesObj);
          let rowLine = color(`${timeStr} ${emoji || '  '}  `);

          curveTypes.forEach((curve, index) => {
            const result =
              hasCctBounds || hasIntensityBounds
                ? calculateCCT(
                    lat as number,
                    lon as number,
                    currentTime,
                    {
                      cctMinK: typeof cctMinRaw === 'number' ? cctMinRaw : undefined,
                      cctMaxK: typeof cctMaxRaw === 'number' ? cctMaxRaw : undefined,
                      intensityMinPct: typeof iMinRaw === 'number' ? iMinRaw : undefined,
                      intensityMaxPct: typeof iMaxRaw === 'number' ? iMaxRaw : undefined,
                    },
                    CurveType[curve]
                  )
                : calculateCCT(lat as number, lon as number, currentTime, undefined, CurveType[curve]);

            const valueStr = `${result.cct}K/${(result.intensity / 10).toFixed(0)}%`;
            rowLine += color(valueStr.padEnd(colWidths[index + 1]));
          });

          print(rowLine);
        }
        print(chalk.blue(`${'─'.repeat(totalWidth)}\n`));
      } else {
        // Show single curve (original behavior)
        print(chalk.blue('─'.repeat(singleCurveWidth)));
        print(chalk.blue('Time           CCT/Intensity'));
        print(chalk.blue('─'.repeat(singleCurveWidth)));

        for (const currentTime of uniqueTimes) {
          const result =
            hasCctBounds || hasIntensityBounds
              ? calculateCCT(
                  lat as number,
                  lon as number,
                  currentTime,
                  {
                    cctMinK: typeof cctMinRaw === 'number' ? cctMinRaw : undefined,
                    cctMaxK: typeof cctMaxRaw === 'number' ? cctMaxRaw : undefined,
                    intensityMinPct: typeof iMinRaw === 'number' ? iMinRaw : undefined,
                    intensityMaxPct: typeof iMaxRaw === 'number' ? iMaxRaw : undefined,
                  },
                  CurveType[curveTypes[0]]
                )
              : calculateCCT(lat as number, lon as number, currentTime, undefined, CurveType[curveTypes[0]]);
          const timeStr = currentTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          });
          const valueStr = `${result.cct}K/${(result.intensity / 10).toFixed(0)}%`.padEnd(18);

          const { color, emoji } = getSpecialTimeStyling(currentTime, timesObj);
          print(color(`${timeStr} ${emoji || '  '}    ${valueStr}`));
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
