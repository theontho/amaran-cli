import chalk from 'chalk';
import type { Command } from 'commander';
import { CURVE_HELP_TEXT } from '../../daylightSimulation/constants.js';
import { calculateCurrentCCT } from '../../daylightSimulation/currentCct.js';
import { formatLocation } from '../../daylightSimulation/privacyUtil.js';
import type { WeatherOptions } from '../../daylightSimulation/types.js';
import { DEVICE_DEFAULTS } from '../../deviceControl/constants.js';
import type { CommandDeps } from '../../deviceControl/types.js';
import { commandCallbackPromise, isLightDevice } from '../cmdUtils.js';
import { parseStrictNumber } from '../parseUtils.js';

export function registerAutoCct(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('auto-cct [device]')
    .usage('[device] [options]')
    .description('Set CCT for lights (or specific device) based on current location and time (geoip)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .option('-i, --ip <ip>', 'Override IP address for geoip lookup')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-t, --time <time>', 'Manual time (ISO 8601 format, e.g., 2025-10-26T14:30:00)')
    .option('-C, --curve <curve>', CURVE_HELP_TEXT, 'hann')
    .option('-L, --max-lux <value>', 'Max lux output for scaling intensity')
    .option('--cloud-cover <value>', 'Cloud cover (0-1), e.g. 0.5 for 50% clouds')
    .option('--precipitation <type>', 'Precipitation type: none, rain, snow, drizzle')
    .option('--weather', 'Automatically fetch weather from wttr.in and apply modifiers')
    .option('--privacy-off', 'Show full IP address and precise coordinates', false)
    .action(asyncCommand(handleAutoCct(deps)));
}

function handleAutoCct(deps: CommandDeps) {
  const { createController, loadConfig, findDevice } = deps;

  return async (deviceQuery: string | undefined, optionsRaw: Record<string, unknown>) => {
    const options = optionsRaw as {
      url?: string;
      clientId?: string;
      debug?: boolean;
      ip?: string;
      lat?: string;
      lon?: string;
      time?: string;
      curve?: string;
      maxLux?: string;
      cloudCover?: string;
      precipitation?: string;
      weather?: boolean;
      privacyOff: boolean;
    };

    let lat: number | undefined;
    let lon: number | undefined;
    let time = new Date();

    if (options.time) {
      time = new Date(options.time);
      if (Number.isNaN(time.getTime())) {
        console.error(chalk.red('Invalid time format. Use ISO 8601 format (e.g., 2025-10-26T14:30:00)'));
        process.exit(1);
      }
    }

    if (options.lat !== undefined) {
      try {
        lat = parseStrictNumber(options.lat, 'Latitude');
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    }
    if (options.lon !== undefined) {
      try {
        lon = parseStrictNumber(options.lon, 'Longitude');
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    }

    let calculation: Awaited<ReturnType<typeof calculateCurrentCCT>>;
    try {
      calculation = await calculateCurrentCCT(
        {
          lat,
          lon,
          ip: options.ip,
          time,
          curve: options.curve,
          maxLux: options.maxLux,
          cloudCover: options.cloudCover,
          precipitation: options.precipitation as WeatherOptions['precipitation'] | undefined,
          weather: options.weather,
          debug: options.debug,
        },
        { loadConfig }
      );
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    for (const warning of calculation.warnings) {
      console.warn(chalk.yellow(warning));
    }

    if (options.debug && calculation.weatherSource === 'auto' && calculation.weatherOptions) {
      console.log(
        chalk.gray(
          `  Auto-weather: cloudCover=${calculation.weatherOptions.cloudCover}, precipitation=${calculation.weatherOptions.precipitation} (from ${calculation.weatherDataSource})`
        )
      );
    }

    const controller = await createController(options.url, options.clientId, options.debug);
    const { result, percent } = calculation;

    console.log(chalk.blue(`Setting CCT to ${result.cct}K at ${percent}% for active lights`));
    console.log(
      chalk.gray(
        `  Location: ${formatLocation(calculation.lat, calculation.lon, calculation.source, options.privacyOff)}`
      )
    );
    const formattedDate = time.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const formattedTime = time.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    console.log(chalk.gray(`  Time: ${formattedDate}, ${formattedTime}`));
    console.log(chalk.gray(`  Curve: ${calculation.curveType.toLowerCase()}`));
    console.log(chalk.gray(`  Mode: ${calculation.modeDescription}`));
    if (calculation.effectiveMaxLux !== undefined && result.lightOutput !== undefined) {
      const originalLux = Math.round(calculation.originalResult?.lightOutput || 0);
      console.log(chalk.gray(`  Target Output: ${Math.round(result.lightOutput)} lux (original: ${originalLux} lux)`));
    }
    if (options.cloudCover || options.precipitation) {
      const weatherInfo = [];
      if (options.cloudCover) weatherInfo.push(`Clouds: ${options.cloudCover}`);
      if (options.precipitation) weatherInfo.push(`Precip: ${options.precipitation}`);
      console.log(chalk.gray(`  Weather: ${weatherInfo.join(', ')}`));
    } else if (calculation.weatherSource === 'auto' && calculation.weatherOptions) {
      const weatherInfo = [];
      if (calculation.weatherOptions.cloudCover !== undefined) {
        weatherInfo.push(`Clouds: ${calculation.weatherOptions.cloudCover}`);
      }
      if (calculation.weatherOptions.precipitation) {
        weatherInfo.push(`Precip: ${calculation.weatherOptions.precipitation}`);
      }
      console.log(chalk.gray(`  Weather (Auto): ${weatherInfo.join(', ')}`));
    }

    let candidateDevices: unknown[] = [];
    if (deviceQuery && deviceQuery.toLowerCase() !== 'all') {
      const device = findDevice(controller, deviceQuery);
      if (!device) {
        console.error(chalk.red(`Device "${deviceQuery}" not found`));
        await controller.disconnect();
        process.exit(1);
      }
      candidateDevices = [device];
    } else {
      candidateDevices = controller.getDevices?.() ?? [];
    }

    type LightDevice = {
      node_id: string;
      device_name?: string;
      name?: string;
      id?: string;
      [key: string]: unknown;
    };

    const lightDevices = candidateDevices.filter((device): device is LightDevice =>
      isLightDevice(device as LightDevice)
    );

    if (lightDevices.length === 0) {
      console.log(chalk.yellow('No light devices found; skipping auto CCT update.'));
      await controller.disconnect();
      return;
    }

    const waitMs = DEVICE_DEFAULTS.statusCheckDelay;
    const offDevices: LightDevice[] = [];
    const activeDevices: LightDevice[] = [];

    const hasSleep = (o: unknown): o is { sleep: unknown } =>
      typeof o === 'object' && o !== null && 'sleep' in (o as Record<string, unknown>);

    const getSleepStatus = async (nodeId: string): Promise<boolean | undefined> => {
      return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(undefined);
          }
        }, 3000);

        controller.getLightSleepStatus?.(nodeId, (success: boolean, _message: string, data?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (!success) {
            resolve(undefined);
            return;
          }
          // Normalize various possible representations of sleep state
          if (data) {
            if (hasSleep(data)) {
              const v = (data as { sleep: unknown }).sleep;
              if (typeof v === 'boolean') {
                resolve(v);
                return;
              }
              if (typeof v === 'number') {
                resolve(v !== 0);
                return;
              }
              if (typeof v === 'string') {
                const s = v.trim().toLowerCase();
                resolve(s === 'true' || s === '1' || s === 'on' || s === 'sleep');
                return;
              }
            }
            const inner = (data as { data?: unknown }).data;
            if (typeof inner === 'boolean') {
              resolve(inner);
              return;
            }
            if (typeof inner === 'number') {
              resolve(inner !== 0);
              return;
            }
            if (typeof inner === 'string') {
              const s = inner.trim().toLowerCase();
              resolve(s === 'true' || s === '1' || s === 'on' || s === 'sleep');
              return;
            }
            if (hasSleep(inner)) {
              const v = (inner as { sleep: unknown }).sleep;
              if (typeof v === 'boolean') {
                resolve(v);
                return;
              }
              if (typeof v === 'number') {
                resolve(v !== 0);
                return;
              }
              if (typeof v === 'string') {
                const s = v.trim().toLowerCase();
                resolve(s === 'true' || s === '1' || s === 'on' || s === 'sleep');
                return;
              }
            }
          }
          resolve(undefined);
        });
      });
    };

    for (const device of lightDevices) {
      const nodeId = device.node_id as string;
      const sleep = await getSleepStatus(nodeId);
      if (sleep === false) {
        activeDevices.push(device);
      } else {
        offDevices.push(device);
      }
    }

    if (activeDevices.length === 0) {
      console.log(chalk.yellow('All discovered lights are off; nothing to update.'));
      if (offDevices.length > 0) {
        console.log(chalk.gray(`  Skipped ${offDevices.length} light(s) to avoid turning them on.`));
      }
      await controller.disconnect();
      return;
    }

    console.log(
      chalk.gray(
        `  Updating ${activeDevices.length} light(s)${
          offDevices.length ? `, skipped ${offDevices.length} off light(s)` : ''
        }`
      )
    );

    for (let i = 0; i < activeDevices.length; i++) {
      const device = activeDevices[i];
      const displayName =
        typeof device.device_name === 'string'
          ? device.device_name
          : typeof device.name === 'string'
            ? device.name
            : typeof device.id === 'string'
              ? device.id
              : device.node_id;

      console.log(`  Setting ${displayName} (${device.node_id}) to ${result.cct}K at ${percent}%`);
      await commandCallbackPromise((callback) => controller.setCCT(device.node_id, result.cct, percent * 10, callback));
      if (i < activeDevices.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    await controller.disconnect();
  };
}

export default registerAutoCct;
