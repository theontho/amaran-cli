import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { Command } from 'commander';
import { ScheduleMaker } from '../../daylightSimulation/scheduleMaker.js';
import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

type GraphCommandOptions = {
  lat?: string;
  lon?: string;
  date?: string;
  curve?: string;
  width?: string;
  height?: string;
  output?: string;
  metrics?: string;
};

export function registerGraphSchedule(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  program
    .command('graph-schedule')
    .description('Generate a graph of the auto-cct schedule')
    .option('-y, --lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('-x, --lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('-d, --date <date>', 'Date to preview (ISO format, e.g., 2025-10-26)')
    .option(
      '-C, --curve <curve>',
      'Curve type (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight)'
    )
    .option('-o, --output <filename>', 'Output filename (default: schedule-<date>.png)')
    .option('-W, --width <width>', 'Image width in pixels (default: 1200)', '1200')
    .option('-H, --height <height>', 'Image height in pixels (default: 600)', '600')
    .option('-m, --metrics <type>', 'Metrics to graph: cct, intensity, or both (default: both)', 'both')
    .action(asyncCommand(handleGraphSchedule(deps)));
}

function handleGraphSchedule(deps: CommandDeps) {
  return async (options: CommandOptions & GraphCommandOptions) => {
    const maker = new ScheduleMaker(deps);

    let schedule: Awaited<ReturnType<typeof maker.makeSchedule>>;
    try {
      // For graphing, we want minute-by-minute granularity for a smooth curve
      schedule = await maker.makeSchedule({
        lat: options.lat,
        lon: options.lon,
        date: options.date,
        intervalMinutes: 1,
        curves: options.curve,
        includeSpecialTimes: false, // Cleaner graph with regular intervals
        bufferMinutes: 60,
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }

    interface ChartDataset {
      label: string;
      data: number[];
      borderColor: string;
      backgroundColor: string;
      yAxisID: string;
      fill: boolean;
      borderDash?: number[];
      pointRadius: number;
      borderWidth: number;
    }

    const datasets: ChartDataset[] = [];
    const labels: string[] = schedule.points.map((p) => {
      if (p.time.getMinutes() === 0) {
        return p.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      }
      return '';
    });

    const showIntensity = options.metrics === 'intensity' || options.metrics === 'both';
    const showCct = options.metrics === 'cct' || options.metrics === 'both';

    const colors = [
      'rgb(54, 162, 235)', // Blue
      'rgb(255, 99, 132)', // Red
      'rgb(75, 192, 192)', // Teal
      'rgb(255, 205, 86)', // Yellow
      'rgb(153, 102, 255)', // Purple
      'rgb(255, 159, 64)', // Orange
      'rgb(75, 192, 75)', // Green
      'rgb(255, 0, 255)', // Magenta
    ];

    schedule.curves.forEach((curve, index) => {
      const color = schedule.curves.length > 1 ? colors[index % colors.length] : 'rgb(54, 162, 235)';
      const cctColor = schedule.curves.length > 1 ? colors[index % colors.length] : 'rgb(255, 99, 132)';

      if (showIntensity) {
        datasets.push({
          label: schedule.curves.length > 1 ? `${curve} (Int)` : 'Intensity (%)',
          data: schedule.points.map((p) => (p.values.get(curve)?.intensity ?? 0) / 10),
          borderColor: color,
          backgroundColor: 'transparent',
          yAxisID: 'y',
          fill: false,
          borderDash: showIntensity && showCct ? [5, 5] : [],
          pointRadius: 0,
          borderWidth: 2,
        });
      }

      if (showCct) {
        datasets.push({
          label: schedule.curves.length > 1 ? `${curve} (CCT)` : 'CCT (K)',
          data: schedule.points.map((p) => p.values.get(curve)?.cct ?? 0),
          borderColor: cctColor,
          backgroundColor: 'transparent',
          yAxisID: 'y1',
          fill: false,
          pointRadius: 0,
          borderWidth: 2,
        });
      }
    });

    const width = parseInt(options.width || '1200', 10);
    const height = parseInt(options.height || '600', 10);
    const canvas = new ChartJSNodeCanvas({ width, height });

    const titleCurve =
      schedule.curves.length > 1
        ? schedule.curves.length === 7
          ? 'All Curves'
          : 'Multiple Curves'
        : schedule.curves[0];

    const configuration = {
      type: 'line' as const,
      data: { labels, datasets },
      options: {
        plugins: {
          title: {
            display: true,
            text: `Schedule: ${schedule.date.toDateString()} (Lat: ${schedule.lat.toFixed(2)}, Lon: ${schedule.lon.toFixed(2)}) - Curve: ${titleCurve}`,
          },
        },
        scales: {
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 45,
              callback: (_val: unknown, index: number) => labels[index],
            },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: 'Intensity (%)' },
            min: 0,
            max: 100,
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: { display: true, text: 'CCT (K)' },
          },
        },
      },
    };

    try {
      // biome-ignore lint/suspicious/noExplicitAny: Chart.js configuration type is complex
      const buffer = await canvas.renderToBuffer(configuration as any);
      let filename = options.output;
      if (!filename) {
        const dateStr = schedule.date.toISOString().split('T')[0];
        filename = `schedule-${dateStr}.png`;
      }
      if (!filename.toLowerCase().endsWith('.png')) filename += '.png';
      const outputPath = path.resolve(process.cwd(), filename);
      fs.writeFileSync(outputPath, buffer);
      console.log(chalk.green(`Graph saved to ${outputPath}`));
    } catch (error) {
      console.error(chalk.red('Error generating graph:'), error);
      process.exit(1);
    }
  };
}

export default registerGraphSchedule;
