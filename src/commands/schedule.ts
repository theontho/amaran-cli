import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

export function registerSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand, loadConfig } = deps;

  program
    .command('schedule')
    .description('Preview auto-cct schedule from sunrise to sunset')
    .option('--lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('--lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('--date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option('--interval <minutes>', 'Minutes between schedule entries (default: 30)', '30')
    .action(
      asyncCommand(async (options: CommandOptions) => {
        const { getLocationFromIP } = await import('../geoipUtil');
        const { calculateCCT } = await import('../cctUtil');
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
          if (
            config &&
            typeof config.latitude === 'number' &&
            typeof config.longitude === 'number'
          ) {
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
              console.error(
                chalk.red('Could not determine location. Use --lat and --lon to specify manually.')
              );
              process.exit(1);
            }
            [lat, lon] = location.ll;
            source = `geoip (${data.ip})`;
          } catch (_err) {
            console.error(
              chalk.red('Could not determine location. Use --lat and --lon to specify manually.')
            );
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

        if (
          !sunrise ||
          !sunset ||
          Number.isNaN(sunrise.getTime()) ||
          Number.isNaN(sunset.getTime())
        ) {
          console.error(chalk.red('Could not calculate sunrise/sunset for this location and date'));
          process.exit(1);
        }

        console.log(
          chalk.blue.bold('\n═══════════════════════════════════════════════════════════')
        );
        console.log(chalk.blue.bold('               Auto-CCT Schedule Preview'));
        console.log(
          chalk.blue.bold('═══════════════════════════════════════════════════════════\n')
        );

        console.log(chalk.cyan(`Location: ${lat.toFixed(4)}°, ${lon.toFixed(4)}° (${source})`));
        console.log(
          chalk.cyan(
            `Date: ${date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
          )
        );
        console.log(chalk.cyan(`Interval: Every ${interval} minute${interval !== 1 ? 's' : ''}\n`));

        console.log(
          chalk.gray(
            `Sunrise:     ${sunrise.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          )
        );
        console.log(
          chalk.gray(
            `Solar Noon:  ${solarNoon.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          )
        );
        console.log(
          chalk.gray(
            `Sunset:      ${sunset.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          )
        );

        console.log(chalk.blue('\n───────────────────────────────────────────────────────────'));
        console.log(chalk.bold('Time          CCT         Intensity'));
        console.log(chalk.blue('───────────────────────────────────────────────────────────'));

        const startTime = new Date(sunrise.getTime() - 30 * 60 * 1000);
        const endTime = new Date(sunset.getTime() + 30 * 60 * 1000);
        const intervalMs = interval * 60 * 1000;
        const highlightThreshold = intervalMs / 2;

        let currentTime = new Date(startTime);
        // Respect user-configured bounds if provided
        const cfg: Record<string, unknown> =
          typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {};
        const cctMinRaw = cfg.cctMin;
        const cctMaxRaw = cfg.cctMax;
        const iMinRaw = cfg.intensityMin;
        const iMaxRaw = cfg.intensityMax;
        const hasCctBounds = typeof cctMinRaw === 'number' || typeof cctMaxRaw === 'number';
        const hasIntensityBounds = typeof iMinRaw === 'number' || typeof iMaxRaw === 'number';

        while (currentTime <= endTime) {
          const result =
            hasCctBounds || hasIntensityBounds
              ? calculateCCT(lat, lon, currentTime, {
                  cctMinK: typeof cctMinRaw === 'number' ? cctMinRaw : undefined,
                  cctMaxK: typeof cctMaxRaw === 'number' ? cctMaxRaw : undefined,
                  intensityMinPct: typeof iMinRaw === 'number' ? iMinRaw : undefined,
                  intensityMaxPct: typeof iMaxRaw === 'number' ? iMaxRaw : undefined,
                })
              : calculateCCT(lat, lon, currentTime);
          const timeStr = currentTime.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          });
          const cctStr = `${result.cct}K`.padEnd(10);
          const intensityStr = `${(result.intensity / 10).toFixed(0)}%`;

          let color = chalk.white;
          const timeDiffSunrise = Math.abs(currentTime.getTime() - sunrise.getTime());
          const timeDiffNoon = Math.abs(currentTime.getTime() - solarNoon.getTime());
          const timeDiffSunset = Math.abs(currentTime.getTime() - sunset.getTime());

          if (timeDiffSunrise < highlightThreshold) {
            color = chalk.yellow;
          } else if (timeDiffNoon < highlightThreshold) {
            color = chalk.green.bold;
          } else if (timeDiffSunset < highlightThreshold) {
            color = chalk.magenta;
          }

          console.log(color(`${timeStr}    ${cctStr}  ${intensityStr}`));
          currentTime = new Date(currentTime.getTime() + intervalMs);
        }

        console.log(chalk.blue('───────────────────────────────────────────────────────────\n'));
        console.log(
          chalk.gray('Legend: ') +
            chalk.yellow('Sunrise') +
            chalk.gray(' | ') +
            chalk.green.bold('Solar Noon') +
            chalk.gray(' | ') +
            chalk.magenta('Sunset')
        );
        console.log();
      })
    );
}

export default registerSchedule;
