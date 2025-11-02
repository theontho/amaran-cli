import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

// Special time configuration - single source of truth for colors and emojis
const SPECIAL_TIME_CONFIG = [
  { key: 'nightEnd', color: chalk.blue, emoji: 'NE' },
  { key: 'nauticalDawn', color: chalk.cyan, emoji: 'ND' },
  { key: 'dawn', color: chalk.cyan, emoji: 'DA' },
  { key: 'sunrise', color: chalk.yellow, emoji: 'SR' },
  { key: 'sunriseEnd', color: chalk.yellow, emoji: 'SE' },
  { key: 'goldenHourEnd', color: chalk.yellow, emoji: 'GE' },
  { key: 'solarNoon', color: chalk.green.bold, emoji: 'SN' },
  { key: 'goldenHour', color: chalk.yellow, emoji: 'GH' },
  { key: 'sunsetStart', color: chalk.magenta, emoji: 'SB' },
  { key: 'sunset', color: chalk.magenta, emoji: 'SS' },
  { key: 'nauticalDusk', color: chalk.magenta, emoji: 'ND' },
  { key: 'dusk', color: chalk.magenta, emoji: 'DU' },
  { key: 'night', color: chalk.blue, emoji: 'NI' },
] as const;

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

// Helper function to generate legend from the configuration
function generateLegend(): void {
  const formatTitle = (key: string): string => {
    return key
      .replace(/([A-Z])/g, ' $1') // Add space before capital letters
      .replace(/^([a-z])/, (c) => c.toUpperCase()) // Capitalize first letter
      .trim();
  };

  const legendItems = SPECIAL_TIME_CONFIG.map((config) => config.color(`${config.emoji} ${formatTitle(config.key)}`));

  // Split legend into 3 lines for better readability
  const firstLine = legendItems.slice(0, 5).join(chalk.gray(' | '));
  const secondLine = legendItems.slice(5, 10).join(chalk.gray(' | '));
  const thirdLine = legendItems.slice(10).join(chalk.gray(' | '));

  console.log(chalk.gray('Legend: ') + firstLine);
  console.log(chalk.gray('        ') + secondLine);
  console.log(chalk.gray('        ') + thirdLine);
}

function registerSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand, loadConfig } = deps;

  program
    .command('schedule')
    .description('Preview auto-cct schedule from sunrise to sunset')
    .option('--lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('--lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('--date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option('--interval <minutes>', 'Minutes between schedule entries (default: 30)', '30')
    .option(
      '--curve <curve>',
      'Curve type for CCT calculation (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight)'
    )
    .action(
      asyncCommand(async (options: CommandOptions) => {
        const { getLocationFromIP } = await import('../geoipUtil');
        const { calculateCCT, CurveType, parseCurveType } = await import('../cctUtil');
        const { getTimes } = await import('suncalc');

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

        // Validate curve option - if no curve specified, show all curves
        let showAllCurves = false;
        let curveType: keyof typeof CurveType;
        if (options.curve) {
          try {
            curveType = parseCurveType(options.curve);
          } catch (error) {
            console.error(chalk.red((error as Error).message));
            process.exit(1);
          }
        } else {
          showAllCurves = true;
          curveType = 'HANN'; // fallback for single curve calculations
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

        console.log(chalk.blue.bold('\n═══════════════════════════════════════════════════════════'));
        console.log(chalk.blue.bold('               Auto-CCT Schedule Preview'));
        console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════\n'));

        console.log(chalk.cyan(`Location: ${lat.toFixed(4)}°, ${lon.toFixed(4)}° (${source})`));
        console.log(
          chalk.cyan(
            `Date: ${date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          )
        );
        console.log(chalk.cyan(`Interval: Every ${interval} minute${interval !== 1 ? 's' : ''}`));
        if (showAllCurves) {
          console.log(chalk.cyan(`Curve: All available curves\n`));
        } else {
          console.log(chalk.cyan(`Curve: ${curveType.toLowerCase()}\n`));
        }

        console.log(
          chalk.gray(`Sunrise:     ${sunrise.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`)
        );
        console.log(
          chalk.gray(`Solar Noon:  ${solarNoon.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`)
        );
        console.log(
          chalk.gray(`Sunset:      ${sunset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`)
        );
        console.log(
          chalk.gray(`Nadir:       ${nadir.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`)
        );

        console.log(chalk.blue('\n'));

        // Calculate time range - extend beyond special times
        const allSpecialTimes = [
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
          .map((time) => time?.getTime());

        if (allSpecialTimes.length === 0) {
          console.error(chalk.red('Could not calculate special times for this location and date'));
          process.exit(1);
        }

        const minTime = new Date(Math.min(...allSpecialTimes));
        const maxTime = new Date(Math.max(...allSpecialTimes));
        const bufferMs = interval * 60 * 1000; // 1 interval unit on each side

        const startTime = new Date(minTime.getTime() - bufferMs);
        const endTime = new Date(maxTime.getTime() + bufferMs);
        const intervalMs = interval * 60 * 1000;
        const _highlightThreshold = intervalMs / 2;

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
        ].filter((time) => time && !Number.isNaN(time.getTime()));

        allTimes.push(...specialTimes);

        // Sort all times and remove duplicates (within 1 minute tolerance)
        allTimes.sort((a, b) => a.getTime() - b.getTime());
        const uniqueTimes: Date[] = [];
        const duplicateThresholdMs = 60 * 1000; // 1 minute

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

        // Calculate table widths
        const multiCurveColWidths = [13, 12, 12, 12, 12, 12, 12, 12];
        const totalWidth = multiCurveColWidths.reduce((a, b) => a + b, 0);
        const singleCurveWidth = 13 + 18; // Time width + CCT/Intensity width

        if (showAllCurves) {
          // Show all curves in one table with compact formatting
          const _allCurveTypes = Object.values(CurveType);
          const headers = ['Time', 'HANN', 'WM_SMALL', 'WM_MEDIUM', 'WM_LARGE', 'CIE', 'SUN_ALT', 'PEREZ'];
          const colWidths = multiCurveColWidths;
          // Print header
          let headerLine = '';
          headers.forEach((header, i) => {
            headerLine += header.padEnd(colWidths[i]);
          });

          console.log(chalk.blue('─'.repeat(totalWidth)));
          console.log(chalk.bold(headerLine));
          console.log(chalk.blue('─'.repeat(totalWidth)));

          for (const currentTime of uniqueTimes) {
            const timeStr = currentTime.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            });

            // Create times object for helper function
            const times = {
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
            };

            const { color, emoji } = getSpecialTimeStyling(currentTime, times);
            let rowLine = color(`${timeStr} ${emoji || '  '}  `);

            // Calculate for each curve in fixed order
            const curvesInOrder = [
              CurveType.HANN,
              CurveType.WIDER_MIDDLE_SMALL,
              CurveType.WIDER_MIDDLE_MEDIUM,
              CurveType.WIDER_MIDDLE_LARGE,
              CurveType.CIE_DAYLIGHT,
              CurveType.SUN_ALTITUDE,
              CurveType.PEREZ_DAYLIGHT,
            ];

            curvesInOrder.forEach((curve, index) => {
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
                      curve
                    )
                  : calculateCCT(lat, lon, currentTime, undefined, curve);

              const valueStr = `${result.cct}K/${(result.intensity / 10).toFixed(0)}%`;
              rowLine += color(valueStr.padEnd(colWidths[index + 1]));
            });

            console.log(rowLine);
          }
        } else {
          // Show single curve (original behavior)
          console.log(chalk.blue('─'.repeat(singleCurveWidth)));
          console.log(chalk.bold('Time           CCT/Intensity'));
          console.log(chalk.blue('─'.repeat(singleCurveWidth)));

          for (const currentTime of uniqueTimes) {
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
                    CurveType[curveType]
                  )
                : calculateCCT(lat, lon, currentTime, undefined, CurveType[curveType]);
            const timeStr = currentTime.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            });
            const valueStr = `${result.cct}K/${(result.intensity / 10).toFixed(0)}%`.padEnd(18);

            // Create times object for helper function
            const times = {
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
            };

            const { color, emoji } = getSpecialTimeStyling(currentTime, times);
            console.log(color(`${timeStr} ${emoji || '  '}    ${valueStr}`));
          }
        }

        if (showAllCurves) {
          console.log(chalk.blue('─'.repeat(totalWidth) + '\n'));
        } else {
          console.log(chalk.blue('─'.repeat(singleCurveWidth) + '\n'));
        }
        generateLegend();
        console.log();
      })
    );
}

export default registerSchedule;
