import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps } from '../../deviceControl/types.js';

export function registerWeather(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('weather')
    .description('Get current weather for location and its effect on lighting')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-i, --ip <ip>', 'Override IP address for geoip lookup')
    .option('--privacy-off', 'Show full IP address and precise coordinates', false)
    .option('-d, --debug', 'Enable debug mode')
    .action(asyncCommand(handleWeather(deps)));
}

function handleWeather(deps: CommandDeps) {
  const { loadConfig } = deps;

  return async (options: { lat?: string; lon?: string; ip?: string; debug?: boolean; privacyOff: boolean }) => {
    const { privacyOff } = options;
    const { getLocationFromIP } = await import('../../daylightSimulation/geoipUtil.js');
    const { getWeatherData } = await import('../../daylightSimulation/weatherUtil.js');
    const { formatLocation } = await import('../../daylightSimulation/privacyUtil.js');

    let lat: number | undefined;
    let lon: number | undefined;
    let source = '';

    // 1. Check CLI options
    if (options.lat && options.lon) {
      lat = parseFloat(options.lat);
      lon = parseFloat(options.lon);
      source = 'manual';
    }
    // 2. Check config
    else if (loadConfig) {
      const config = loadConfig();
      if (config?.latitude && config?.longitude) {
        lat = config.latitude;
        lon = config.longitude;
        source = 'config';
      }
    }

    // 3. Check GeoIP
    if (lat === undefined || lon === undefined) {
      let ip = options.ip;
      if (!ip) {
        try {
          const res = await fetch('https://api.ipify.org?format=json');
          const data = await res.json();
          ip = data.ip;
        } catch (_err) {
          ip = '127.0.0.1';
        }
      }
      const location = getLocationFromIP(ip);
      if (location?.ll) {
        [lat, lon] = location.ll;
        source = `geoip (${ip})`;
      }
    }

    if (lat === undefined || lon === undefined) {
      console.error(chalk.red('Could not determine location. Use --lat and --lon or configure defaults.'));
      process.exit(1);
    }

    const weather = await getWeatherData(lat, lon, new Date(), options.debug);
    const description = weather.description || weather.raw?.current_condition?.[0].weatherDesc?.[0]?.value;

    console.log(chalk.blue(`Weather for ${formatLocation(lat, lon, source, privacyOff)}`));
    if (description || weather.temp_C) {
      const tempC = weather.temp_C || weather.raw?.current_condition?.[0].temp_C;
      console.log(chalk.gray(`  Current: ${description || 'Unknown'}, ${tempC || '?'}°C`));
    }

    const now = new Date();
    console.log(chalk.gray(`  Current Time: ${now.toLocaleTimeString()}`));

    const sourceDesc =
      weather.source === 'api'
        ? 'wttr.in API (Current Condition)'
        : weather.source === 'forecast'
          ? 'Hourly Forecast (Cache)'
          : 'Cache (Current Condition)';
    console.log(chalk.gray(`  Source: ${sourceDesc}`));

    if (weather.effectiveTime) {
      const timeInfo = [weather.effectiveTime];
      if (weather.dataTimestamp) {
        const diffMs = now.getTime() - weather.dataTimestamp;
        const diffMins = Math.round(Math.abs(diffMs) / 60000);
        const relativeStr = diffMs >= 0 ? `${diffMins}m ago` : `in ${diffMins}m`;
        timeInfo.push(`(${relativeStr})`);
      }
      console.log(chalk.gray(`  Weather Time: ${timeInfo.join(' ')}`));
    }
    console.log(chalk.blue('  Lighting Parameters:'));
    console.log(chalk.gray(`    Cloud Cover: ${Math.round((weather.cloudCover ?? 0) * 100)}%`));
    console.log(chalk.gray(`    Precipitation: ${weather.precipitation ?? 'none'}`));

    if (options.debug && weather.raw) {
      console.log(chalk.gray('  Full data:'), JSON.stringify(weather.raw.current_condition[0], null, 2));
    }
  };
}

export default registerWeather;
