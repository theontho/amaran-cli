import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

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

        console.log(chalk.blue('\n───────────────────────────────────────────────────────────'));

        // Calculate time range - extend beyond special times
        const allSpecialTimes = [nightEnd, dawn, sunrise, goldenHourEnd, solarNoon, goldenHour, sunset, dusk, night]
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
        const highlightThreshold = intervalMs / 2;

        let currentTime = new Date(startTime);
        // Respect user-configured bounds if provided
        const cfg: Record<string, unknown> = typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {};
        const cctMinRaw = cfg.cctMin;
        const cctMaxRaw = cfg.cctMax;
        const iMinRaw = cfg.intensityMin;
        const iMaxRaw = cfg.intensityMax;
        const hasCctBounds = typeof cctMinRaw === 'number' || typeof cctMaxRaw === 'number';
        const hasIntensityBounds = typeof iMinRaw === 'number' || typeof iMaxRaw === 'number';

        if (showAllCurves) {
          // Show all curves in one table with compact formatting
          const _allCurveTypes = Object.values(CurveType);
          const headers = ['Time', 'HANN', 'WM_SMALL', 'WM_MEDIUM', 'WM_LARGE', 'CIE', 'SUN_ALT', 'PEREZ'];
          const colWidths = [12, 12, 12, 12, 12, 12, 12, 12];

          // Print header
          let headerLine = '';
          headers.forEach((header, i) => {
            headerLine += header.padEnd(colWidths[i]);
          });
          console.log(chalk.bold(headerLine));
          console.log(chalk.blue('─'.repeat(colWidths.reduce((a, b) => a + b, 0))));

          while (currentTime <= endTime) {
            const timeStr = currentTime.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            });

            let color = chalk.white;
            let emoji = '';
            const timeDiffSunrise = Math.abs(currentTime.getTime() - sunrise.getTime());
            const timeDiffNoon = Math.abs(currentTime.getTime() - solarNoon.getTime());
            const timeDiffSunset = Math.abs(currentTime.getTime() - sunset.getTime());
            const timeDiffDawn = Math.abs(currentTime.getTime() - dawn.getTime());
            const timeDiffDusk = Math.abs(currentTime.getTime() - dusk.getTime());
            const timeDiffGoldenHour = Math.abs(currentTime.getTime() - goldenHour.getTime());
            const timeDiffGoldenHourEnd = Math.abs(currentTime.getTime() - goldenHourEnd.getTime());
            const timeDiffNight = Math.abs(currentTime.getTime() - night.getTime());
            const timeDiffNightEnd = Math.abs(currentTime.getTime() - nightEnd.getTime());

            // Check time periods in order of priority (most specific first)
            if (timeDiffNightEnd < highlightThreshold) {
              color = chalk.blue;
              emoji = ' 🌄';
            } else if (timeDiffDawn < highlightThreshold) {
              color = chalk.cyan;
              emoji = ' 🌅';
            } else if (timeDiffSunrise < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' ☀️  ';
            } else if (timeDiffGoldenHourEnd < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' 🌇';
            } else if (timeDiffNoon < highlightThreshold) {
              color = chalk.green.bold;
              emoji = ' 🌞';
            } else if (timeDiffGoldenHour < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' 🌆';
            } else if (timeDiffSunset < highlightThreshold) {
              color = chalk.magenta;
              emoji = ' 🌅';
            } else if (timeDiffDusk < highlightThreshold) {
              color = chalk.magenta;
              emoji = ' 🌆';
            } else if (timeDiffNight < highlightThreshold) {
              color = chalk.blue;
              emoji = ' 🌙';
            }

            let rowLine = color(`${timeStr}${emoji}`.padEnd(colWidths[0]));

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
            currentTime = new Date(currentTime.getTime() + intervalMs);
          }
        } else {
          // Show single curve (original behavior)
          console.log(chalk.bold('Time           CCT/Intensity'));
          console.log(chalk.blue('───────────────────────────────────────────────────────────'));

          while (currentTime <= endTime) {
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

            let color = chalk.white;
            let emoji = '';
            const timeDiffSunrise = Math.abs(currentTime.getTime() - sunrise.getTime());
            const timeDiffNoon = Math.abs(currentTime.getTime() - solarNoon.getTime());
            const timeDiffSunset = Math.abs(currentTime.getTime() - sunset.getTime());
            const timeDiffDawn = Math.abs(currentTime.getTime() - dawn.getTime());
            const timeDiffDusk = Math.abs(currentTime.getTime() - dusk.getTime());
            const timeDiffGoldenHour = Math.abs(currentTime.getTime() - goldenHour.getTime());
            const timeDiffGoldenHourEnd = Math.abs(currentTime.getTime() - goldenHourEnd.getTime());
            const timeDiffNight = Math.abs(currentTime.getTime() - night.getTime());
            const timeDiffNightEnd = Math.abs(currentTime.getTime() - nightEnd.getTime());

            // Check time periods in order of priority (most specific first)
            if (timeDiffNightEnd < highlightThreshold) {
              color = chalk.blue;
              emoji = ' 🌄';
            } else if (timeDiffDawn < highlightThreshold) {
              color = chalk.cyan;
              emoji = ' 🌅';
            } else if (timeDiffSunrise < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' ☀️  ';
            } else if (timeDiffGoldenHourEnd < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' 🌇';
            } else if (timeDiffNoon < highlightThreshold) {
              color = chalk.green.bold;
              emoji = ' 🌞';
            } else if (timeDiffGoldenHour < highlightThreshold) {
              color = chalk.yellow;
              emoji = ' 🌆';
            } else if (timeDiffSunset < highlightThreshold) {
              color = chalk.magenta;
              emoji = ' 🌅';
            } else if (timeDiffDusk < highlightThreshold) {
              color = chalk.magenta;
              emoji = ' 🌆';
            } else if (timeDiffNight < highlightThreshold) {
              color = chalk.blue;
              emoji = ' 🌙';
            }

            console.log(color(`${timeStr}${emoji}    ${valueStr}`));
            currentTime = new Date(currentTime.getTime() + intervalMs);
          }
        }

        console.log(chalk.blue('───────────────────────────────────────────────────────────\n'));
        console.log(
          chalk.gray('Legend: ') +
            chalk.blue('🌄 Night End') +
            chalk.gray(' | ') +
            chalk.cyan('🌅 Dawn') +
            chalk.gray(' | ') +
            chalk.yellow('☀️ Sunrise ') +
            chalk.gray(' | ') +
            chalk.yellow('🌇 Golden Hour End')
        );
        console.log(
          chalk.gray('        ') +
            chalk.green.bold('🌞 Solar Noon') +
            chalk.gray(' | ') +
            chalk.yellow('🌆 Golden Hour') +
            chalk.gray(' | ') +
            chalk.magenta('🌅 Sunset') +
            chalk.gray(' | ') +
            chalk.magenta('🌆 Dusk') +
            chalk.gray(' | ') +
            chalk.blue('🌙 Night')
        );
        console.log();
      })
    );
}

export default registerSchedule;
