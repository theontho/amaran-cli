import chalk from 'chalk';
import type { Command } from 'commander';
import { CURVE_HELP_TEXT } from '../../daylightSimulation/constants.js';
import { ScheduleMaker } from '../../daylightSimulation/scheduleMaker.js';
import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

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
    .option('-C, --curve <curve>', CURVE_HELP_TEXT, 'hann')
    .option('--duration <seconds>', 'Simulation duration to compress full day (default: 10 seconds)', '10')
    .option('--cloud-cover <value>', 'Cloud cover (0-1)')
    .option('--precipitation <type>', 'Precipitation type')
    .action(asyncCommand(handleSimulateSchedule(deps)));
}

function handleSimulateSchedule(deps: CommandDeps) {
  const { createController, findDevice, loadConfig } = deps;

  return async (deviceQuery: string, options: CommandOptions) => {
    const { DEVICE_DEFAULTS, ERROR_MESSAGES } = await import('../../deviceControl/constants.js');

    // 1. Make the schedule
    const _maker = new ScheduleMaker(deps);

    // We want a high-resolution schedule for smooth simulation
    // The previous implementation calculated updates based on (duration * 1000) / updateInterval
    // Let's stick to that but use the schedule maker to provide the points.

    const durationCount = parseInt((options.duration ?? '10') as string, 10);
    const updateInterval = DEVICE_DEFAULTS.updateInterval;
    const totalUpdates = Math.floor((durationCount * 1000) / updateInterval);

    const tempTimesMaker = new ScheduleMaker(deps);
    let schedule: Awaited<ReturnType<typeof tempTimesMaker.makeSchedule>>;
    try {
      // For simulation, we need the "full day" bounds
      // The old code used nightEnd to night
      const baseInfo = await tempTimesMaker.makeSchedule({
        lat: options.lat,
        lon: options.lon,
        curves: options.curve,
        cloudCover: options.cloudCover as string | undefined, // ScheduleMaker handles parsing
        precipitation: options.precipitation as string | undefined,
      });

      const nightEnd = baseInfo.times.nightEnd;
      const night = baseInfo.times.night;

      if (!nightEnd || !night || Number.isNaN(nightEnd.getTime()) || Number.isNaN(night.getTime())) {
        throw new Error('Night times unavailable for this location/date');
      }

      const dayDurationMs = night.getTime() - nightEnd.getTime();
      const timeStepMs = dayDurationMs / totalUpdates;

      schedule = await tempTimesMaker.makeSchedule({
        lat: options.lat,
        lon: options.lon,
        curves: options.curve,
        startTime: nightEnd,
        endTime: night,
        intervalMinutes: timeStepMs / (60 * 1000), // convert ms to minutes for the maker's interval
        includeSpecialTimes: false, // Smooth simulation doesn't need jumps to special times
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    // 2. Connect to controller and find device
    const controller = await createController(options.url, options.clientId, options.debug);
    const device = findDevice(controller, deviceQuery);

    if (!device) {
      console.error(chalk.red(ERROR_MESSAGES.deviceNotFound(deviceQuery)));
      await controller.disconnect();
      process.exit(1);
    }

    const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
    const nodeId = device.node_id as string;

    console.log(chalk.blue('\n═══════════════════════════════════════════════════════════'));
    console.log(chalk.blue('               CCT Schedule Simulation'));
    console.log(chalk.blue('═══════════════════════════════════════════════════════════\n'));

    console.log(chalk.cyan(`Device: ${displayName} (${nodeId})`));
    console.log(chalk.cyan(`Location: ${schedule.lat.toFixed(4)}°, ${schedule.lon.toFixed(4)}° (${schedule.source})`));
    console.log(chalk.cyan(`Simulation Duration: ${durationCount} second(s)`));
    console.log(chalk.cyan(`Update Interval: ${updateInterval}ms`));
    console.log(chalk.cyan(`Curve: ${schedule.curves[0]}\n`));

    // 3. Render the schedule by making the lights execute it
    const _cfg = (loadConfig?.() ?? {}) as Record<string, unknown>;

    const runSimulation = async () => {
      const curve = schedule.curves[0];
      for (let i = 0; i < schedule.points.length; i++) {
        const point = schedule.points[i];
        const val = point.values.get(curve);
        if (!val) continue;

        const percent = Math.round((val.intensity / 10) * 10) / 10;

        const progress = Math.round((i / (schedule.points.length - 1)) * 100);
        const timeStr = point.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

        process.stdout.write(
          `\r${chalk.gray(`[${progress}% | ${timeStr}] `)}${chalk.green(`Setting ${displayName} to ${val.cct}K at ${percent}%`)}          `
        );

        controller.setCCT(nodeId, val.cct, val.intensity);

        if (i < schedule.points.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, updateInterval));
        }
      }
      console.log();
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
