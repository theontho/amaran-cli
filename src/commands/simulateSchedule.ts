import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types.js';

export function registerSimulateSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('simulate-schedule')
    .description('Simulate a CCT schedule curve in real-time on a specific device')
    .argument('<device>', 'Device name, ID, or node_id to control')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .option('--lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('--lon <longitude>', 'Manual longitude (-180 to 180)')
    .option(
      '--curve <curve>',
      'Curve type for CCT calculation (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight, default: hann)',
      'hann'
    )
    .option('--duration <seconds>', 'Simulation duration to compress full day (default: 10 seconds)', '10')
    .action(asyncCommand(handleSimulateSchedule(deps)));
}

function handleSimulateSchedule(deps: CommandDeps) {
  const { createController, findDevice, loadConfig } = deps;

  return async (deviceQuery: string, options: CommandOptions) => {
    const { getLocationFromIP } = await import('../geoipUtil.js');
    const { calculateCCT, CurveType, parseCurveType } = await import('../cctUtil.js');
    const { CCT_DEFAULTS, DEVICE_DEFAULTS, VALIDATION_RANGES, ERROR_MESSAGES } = await import('../constants.js');
    const SunCalc = (await import('suncalc')).default;
    const { getTimes } = SunCalc;

    let lat: number | undefined;
    let lon: number | undefined;
    let source = '';

    // Use fixed update interval for smooth visual simulation and to not overwhelm the light
    const updateInterval = DEVICE_DEFAULTS.updateInterval;

    // Validate duration (how long to compress the full day into)
    const duration = parseInt((options.duration ?? '60') as string, 10);
    if (Number.isNaN(duration) || duration < 1) {
      console.error(chalk.red(ERROR_MESSAGES.invalidDuration));
      process.exit(1);
    }

    // Validate curve option
    let curveType: keyof typeof CurveType;
    if (options.curve) {
      try {
        curveType = parseCurveType(options.curve);
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    } else {
      curveType = 'HANN';
    }

    // Get location
    if (options.lat !== undefined && options.lon !== undefined) {
      lat = parseFloat(options.lat);
      lon = parseFloat(options.lon);
      if (Number.isNaN(lat) || lat < VALIDATION_RANGES.latitude.min || lat > VALIDATION_RANGES.latitude.max) {
        console.error(chalk.red(ERROR_MESSAGES.invalidLatitude));
        process.exit(1);
      }
      if (Number.isNaN(lon) || lon < VALIDATION_RANGES.longitude.min || lon > VALIDATION_RANGES.longitude.max) {
        console.error(chalk.red(ERROR_MESSAGES.invalidLongitude));
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
          console.error(chalk.red(ERROR_MESSAGES.locationUnavailable));
          process.exit(1);
        }
        [lat, lon] = location.ll;
        source = `geoip (${data.ip})`;
      } catch (_err) {
        console.error(chalk.red(ERROR_MESSAGES.locationUnavailable));
        process.exit(1);
      }
    }

    // Connect to controller and find device
    const controller = await createController(options.url, options.clientId, options.debug);
    const device = findDevice(controller, deviceQuery);

    if (!device) {
      console.error(chalk.red(ERROR_MESSAGES.deviceNotFound(deviceQuery)));
      await controller.disconnect();
      process.exit(1);
    }

    const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
    const nodeId = device.node_id;

    console.log(chalk.blue('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.blue('               CCT Schedule Simulation'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════\n'));

    console.log(chalk.cyan(`Device: ${displayName} (${nodeId})`));
    console.log(chalk.cyan(`Location: ${lat.toFixed(4)}°, ${lon.toFixed(4)}° (${source})`));
    console.log(chalk.cyan(`Simulation Duration: ${duration} second(s)`));
    console.log(chalk.cyan(`Update Interval: ${updateInterval}ms`));
    console.log(chalk.cyan(`Curve: ${curveType}\n`));

    // Load optional bounds from config
    const cfg: Record<string, unknown> = typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {};
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

    const minKRaw = cfg.cctMin;
    const maxKRaw = cfg.cctMax;
    const minKCfg = typeof minKRaw === 'number' ? minKRaw : undefined;
    const maxKCfg = typeof maxKRaw === 'number' ? maxKRaw : undefined;
    const loK =
      minKCfg !== undefined
        ? clamp(minKCfg, VALIDATION_RANGES.cct.min, VALIDATION_RANGES.cct.max)
        : CCT_DEFAULTS.cctMinK;
    const hiK =
      maxKCfg !== undefined
        ? clamp(maxKCfg, VALIDATION_RANGES.cct.min, VALIDATION_RANGES.cct.max)
        : CCT_DEFAULTS.cctMaxK;

    const minPctRaw = cfg.intensityMin;
    const maxPctRaw = cfg.intensityMax;
    const minPctCfg = typeof minPctRaw === 'number' ? minPctRaw : CCT_DEFAULTS.intensityMinPct;
    const maxPctCfg = typeof maxPctRaw === 'number' ? maxPctRaw : CCT_DEFAULTS.intensityMaxPct;
    const loPct = clamp(
      Math.min(minPctCfg, maxPctCfg),
      VALIDATION_RANGES.intensity.min,
      VALIDATION_RANGES.intensity.max
    );
    const hiPct = clamp(
      Math.max(minPctCfg, maxPctCfg),
      VALIDATION_RANGES.intensity.min,
      VALIDATION_RANGES.intensity.max
    );
    const intensityMultMap = cfg.intensityMultiplier as Record<string, number> | undefined;

    console.log(chalk.gray(`CCT Range: ${Math.min(loK, hiK)}K - ${Math.max(loK, hiK)}K`));
    console.log(chalk.gray(`Intensity Range: ${loPct}% - ${hiPct}%\n`));

    // Calculate the full day schedule (nightEnd to night)
    const today = new Date();
    const times = getTimes(today, lat, lon);
    const nightEnd = times.nightEnd;
    const night = times.night;

    if (!nightEnd || !night || Number.isNaN(nightEnd.getTime()) || Number.isNaN(night.getTime())) {
      console.error(chalk.red(ERROR_MESSAGES.nightTimesUnavailable));
      await controller.disconnect();
      process.exit(1);
    }

    const dayStart = nightEnd;
    const dayEnd = night;
    const dayDurationMs = dayEnd.getTime() - dayStart.getTime();

    const totalUpdates = Math.floor((duration * 1000) / updateInterval);
    const timeStepMs = dayDurationMs / totalUpdates;

    console.log(chalk.yellow(`Simulating full day cycle in ${duration} second(s) with ${totalUpdates} updates\n`));

    const runSimulation = async () => {
      for (let i = 0; i <= totalUpdates; i++) {
        const simulatedTime = new Date(dayStart.getTime() + i * timeStepMs);

        const result = calculateCCT(
          lat,
          lon,
          simulatedTime,
          {
            cctMinK: Math.min(loK, hiK),
            cctMaxK: Math.max(loK, hiK),
            intensityMinPct: loPct,
            intensityMaxPct: hiPct,
          },
          CurveType[curveType]
        );

        const percent = Math.round((result.intensity / 10) * 10) / 10;

        let targetIntensity = percent;
        let multiplierApplied = false;

        if (intensityMultMap) {
          const mult = intensityMultMap[nodeId as string] ?? (device.id ? intensityMultMap[device.id] : undefined);
          if (mult !== undefined && typeof mult === 'number') {
            targetIntensity = Math.round(percent * mult);
            targetIntensity = Math.max(0, Math.min(100, targetIntensity));
            multiplierApplied = true;
          }
        }

        const progress = Math.round((i / totalUpdates) * 100);
        const timeStr = simulatedTime.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        });

        if (multiplierApplied) {
          console.log(
            chalk.gray(`[${progress}% | ${timeStr}] `) +
              chalk.green(`Setting ${displayName} to ${result.cct}K at ${targetIntensity}% (multiplied)`)
          );
        } else {
          console.log(
            chalk.gray(`[${progress}% | ${timeStr}] `) +
              chalk.green(`Setting ${displayName} to ${result.cct}K at ${targetIntensity}%`)
          );
        }

        controller.setCCT(nodeId as string, result.cct, result.intensity * (targetIntensity / percent || 1));

        if (i < totalUpdates) {
          await new Promise((resolve) => setTimeout(resolve, updateInterval));
        }
      }
    };

    const sigintHandler = async () => {
      console.log(chalk.yellow('\n\nSimulation stopped by user'));
      await controller.disconnect();
      process.exit(0);
    };

    process.on('SIGINT', sigintHandler);

    await runSimulation();

    process.off('SIGINT', sigintHandler);

    console.log(chalk.green('\nSimulation completed'));
    await controller.disconnect();
  };
}

export default registerSimulateSchedule;
