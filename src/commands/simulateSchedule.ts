import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types';

export function registerSimulateSchedule(program: Command, deps: CommandDeps) {
  const { createController, findDevice, asyncCommand, loadConfig } = deps;

  program
    .command('simulate-schedule')
    .description('Simulate a CCT schedule curve in real-time on a specific device')
    .argument('<device>', 'Device name, ID, or node_id to control')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .option('--lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('--lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('--curve <curve>', 'Curve type for CCT calculation (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight, default: hann)', 'hann')
    .option('--duration <seconds>', 'Simulation duration to compress full day (default: 60 seconds)', '60')
    .action(
      asyncCommand(async (deviceQuery: string, options: CommandOptions) => {
        const { getLocationFromIP } = await import('../geoipUtil');
        const { calculateCCT, CurveType, parseCurveType } = await import('../cctUtil');
        const { getTimes } = await import('suncalc');
        
        let lat: number | undefined;
        let lon: number | undefined;
        let source = '';

        // Use fixed 250ms update interval for smooth visual simulation
        const updateInterval = 250; // milliseconds

        // Validate duration (how long to compress the full day into)
        const duration = parseInt((options.duration ?? '60') as string, 10);
        if (Number.isNaN(duration) || duration < 1) {
          console.error(chalk.red('Duration must be at least 1 second'));
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

        // Connect to controller and find device
        const controller = await createController(options.url, options.clientId, options.debug);
        const device = findDevice(controller, deviceQuery);
        
        if (!device) {
          console.error(chalk.red(`Device "${deviceQuery}" not found`));
          await controller.disconnect();
          process.exit(1);
        }

        const displayName = device.device_name || device.name || device.id || device.node_id;
        const nodeId = device.node_id;

        console.log(chalk.blue.bold('\n═══════════════════════════════════════════════════════════'));
        console.log(chalk.blue.bold('               CCT Schedule Simulation'));
        console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════\n'));
        
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
        const loK = minKCfg !== undefined ? clamp(minKCfg, 1000, 20000) : 2000;
        const hiK = maxKCfg !== undefined ? clamp(maxKCfg, 1000, 20000) : 6500;

        const minPctRaw = cfg.intensityMin;
        const maxPctRaw = cfg.intensityMax;
        const minPctCfg = typeof minPctRaw === 'number' ? minPctRaw : 5;
        const maxPctCfg = typeof maxPctRaw === 'number' ? maxPctRaw : 100;
        const loPct = clamp(Math.min(minPctCfg, maxPctCfg), 0, 100);
        const hiPct = clamp(Math.max(minPctCfg, maxPctCfg), 0, 100);

        console.log(chalk.gray('CCT Range: ' + Math.min(loK, hiK) + 'K - ' + Math.max(loK, hiK) + 'K'));
        console.log(chalk.gray('Intensity Range: ' + loPct + '% - ' + hiPct + '%\n'));

        // Calculate the full day schedule (sunrise to sunset)
        const today = new Date();
        const times = getTimes(today, lat, lon);
        const sunrise = times.sunrise;
        const sunset = times.sunset;

        if (!sunrise || !sunset || Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
          console.error(chalk.red('Could not calculate sunrise/sunset for this location'));
          await controller.disconnect();
          process.exit(1);
        }

        // Start 30 minutes before sunrise, end 30 minutes after sunset
        const dayStart = new Date(sunrise.getTime() - 30 * 60 * 1000);
        const dayEnd = new Date(sunset.getTime() + 30 * 60 * 1000);
        const dayDurationMs = dayEnd.getTime() - dayStart.getTime();

        // Calculate how many updates we'll do
        const totalUpdates = Math.floor((duration * 1000) / updateInterval);
        const timeStepMs = dayDurationMs / totalUpdates;

        console.log(chalk.yellow(`Simulating full day cycle in ${duration} second(s) with ${totalUpdates} updates\n`));

        const runSimulation = async () => {
          for (let i = 0; i <= totalUpdates; i++) {
            // Calculate the simulated time for this update
            const simulatedTime = new Date(dayStart.getTime() + (i * timeStepMs));
            
            const result = calculateCCT(lat, lon, simulatedTime, {
              cctMinK: Math.min(loK, hiK),
              cctMaxK: Math.max(loK, hiK),
              intensityMinPct: loPct,
              intensityMaxPct: hiPct,
            }, CurveType[curveType]);

            const percent = Math.round((result.intensity / 10) * 10) / 10;
            const progress = Math.round((i / totalUpdates) * 100);
            const timeStr = simulatedTime.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            });
            
            console.log(
              chalk.white(`[${progress}% | ${timeStr}] `) +
              chalk.green(`Setting ${displayName} to ${result.cct}K at ${percent}%`)
            );

            controller.setCCT(nodeId as string, result.cct, result.intensity);
            
            // Wait for the next update (except for the last one)
            if (i < totalUpdates) {
              await new Promise(resolve => setTimeout(resolve, updateInterval));
            }
          }
        };

        // Handle graceful shutdown
        process.on('SIGINT', async () => {
          console.log(chalk.yellow('\n\nSimulation stopped by user'));
          await controller.disconnect();
          process.exit(0);
        });

        await runSimulation();
        
        console.log(chalk.green('\nSimulation completed'));
        await controller.disconnect();
      })
    );
}

export default registerSimulateSchedule;
