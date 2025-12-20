import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { Command } from 'commander';
import type { CommandDeps, CommandOptions } from '../types.js';

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
  const { loadConfig } = deps;

  return async (options: CommandOptions & GraphCommandOptions) => {
    const { getLocationFromIP } = await import('../geoipUtil.js');
    const { calculateCCT, parseCurveType, CurveType } = await import('../cctUtil.js');
    const SunCalc = (await import('suncalc')).default;
    const { getTimes } = SunCalc;

    // --- 1. Determine Location & Date ---

    let lat: number | undefined;
    let lon: number | undefined;
    let date: Date = new Date();

    if (options.date) {
      date = new Date(options.date);
      if (Number.isNaN(date.getTime())) {
        console.error(chalk.red('Invalid date format. Use ISO format (e.g., 2025-10-26)'));
        process.exit(1);
      }
    }

    // Determine curve types to graph
    let curveTypes: (keyof typeof CurveType)[] = ['HANN'];
    const curveOption = options.curve?.toLowerCase() || '';

    // If user explicitly asks for "all" or specific list
    if (curveOption === 'all') {
      curveTypes = Object.keys(CurveType) as (keyof typeof CurveType)[];
    } else if (curveOption) {
      try {
        const parts = curveOption.split(',').map((s) => s.trim());
        const parsedList: (keyof typeof CurveType)[] = [];

        for (const part of parts) {
          if (part === 'all') {
            parsedList.push(...(Object.keys(CurveType) as (keyof typeof CurveType)[]));
          } else {
            parsedList.push(parseCurveType(part));
          }
        }
        // Dedup
        curveTypes = Array.from(new Set(parsedList));
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
      }
    }

    let titleCurve = curveTypes.length > 1 ? 'Multiple Curves' : curveTypes[0];
    if (curveTypes.length === Object.keys(CurveType).length) {
      titleCurve = 'All Curves';
    }

    // Determine Lat/Lon
    if (options.lat !== undefined && options.lon !== undefined) {
      lat = parseFloat(options.lat);
      lon = parseFloat(options.lon);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        console.error(chalk.red('Invalid Latitude'));
        process.exit(1);
      }
      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        console.error(chalk.red('Invalid Longitude'));
        process.exit(1);
      }
    } else if (loadConfig) {
      const config = loadConfig();
      if (config && typeof config.latitude === 'number' && typeof config.longitude === 'number') {
        lat = config.latitude;
        lon = config.longitude;
      }
    }

    if (lat === undefined || lon === undefined) {
      try {
        const res = await fetch('https://api.ipify.org?format=json');
        const data = await res.json();
        const location = getLocationFromIP(data.ip);
        if (!location || !location.ll) throw new Error('Loc fail');
        [lat, lon] = location.ll;
      } catch (_err) {
        console.error(chalk.red('Could not determine location. Use --lat and --lon.'));
        process.exit(1);
      }
    }

    // --- 2. Calculate Configuration Bounds ---
    const cfg: Record<string, unknown> = typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {};
    const cctMinRaw = cfg.cctMin;
    const cctMaxRaw = cfg.cctMax;
    const iMinRaw = cfg.intensityMin;
    const iMaxRaw = cfg.intensityMax;

    const cctOpts = {
      cctMinK: typeof cctMinRaw === 'number' ? cctMinRaw : undefined,
      cctMaxK: typeof cctMaxRaw === 'number' ? cctMaxRaw : undefined,
      intensityMinPct: typeof iMinRaw === 'number' ? iMinRaw : undefined,
      intensityMaxPct: typeof iMaxRaw === 'number' ? iMaxRaw : undefined,
    };

    // --- 3. Generate Data Points ---
    const times = getTimes(date, lat, lon);
    const nightEnd = times.nightEnd;
    const night = times.night;
    const sunrise = times.sunrise;
    const sunset = times.sunset;

    let startTime: Date;
    let endTime: Date;

    if (nightEnd && !Number.isNaN(nightEnd.getTime()) && night && !Number.isNaN(night.getTime())) {
      startTime = nightEnd;
      endTime = night;
    } else if (sunrise && !Number.isNaN(sunrise.getTime()) && sunset && !Number.isNaN(sunset.getTime())) {
      startTime = new Date(sunrise.getTime() - 60 * 60 * 1000);
      endTime = new Date(sunset.getTime() + 60 * 60 * 1000);
    } else {
      startTime = new Date(date);
      startTime.setHours(0, 0, 0, 0);
      endTime = new Date(date);
      endTime.setHours(23, 59, 59, 999);
    }

    const bufferMs = 60 * 60 * 1000;
    startTime = new Date(startTime.getTime() - bufferMs);
    endTime = new Date(endTime.getTime() + bufferMs);

    // biome-ignore lint/suspicious/noExplicitAny: ChartJS dataset types are complex to define manually here
    const datasets: any[] = [];
    const labels: string[] = [];
    const showIntensity = options.metrics === 'intensity' || options.metrics === 'both';
    const showCct = options.metrics === 'cct' || options.metrics === 'both';

    const totalMinutes = Math.ceil((endTime.getTime() - startTime.getTime()) / (60 * 1000));

    for (let i = 0; i <= totalMinutes; i++) {
      const currentTime = new Date(startTime.getTime() + i * 60 * 1000);
      if (currentTime.getMinutes() === 0) {
        labels.push(currentTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
      } else {
        labels.push('');
      }
    }

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

    curveTypes.forEach((curve, index) => {
      const points: { cct: number; intensity: number }[] = [];
      for (let i = 0; i <= totalMinutes; i++) {
        const currentTime = new Date(startTime.getTime() + i * 60 * 1000);
        const result = calculateCCT(lat, lon, currentTime, cctOpts, CurveType[curve]);
        points.push(result);
      }

      const color = curveTypes.length > 1 ? colors[index % colors.length] : 'rgb(54, 162, 235)';
      const cctColor = curveTypes.length > 1 ? colors[index % colors.length] : 'rgb(255, 99, 132)';

      if (showIntensity) {
        datasets.push({
          label: curveTypes.length > 1 ? `${curve} (Int)` : 'Intensity (%)',
          data: points.map((p) => p.intensity / 10),
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
          label: curveTypes.length > 1 ? `${curve} (CCT)` : 'CCT (K)',
          data: points.map((p) => p.cct),
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

    const chartCallback = (_ChartJS: unknown) => {
      // No additional configuration needed
    };
    const canvas = new ChartJSNodeCanvas({ width, height, chartCallback });

    // biome-ignore lint/suspicious/noExplicitAny: ChartJS configuration types are complex to define manually here
    const configuration: any = {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets,
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: `Schedule: ${date.toDateString()} (Lat: ${lat.toFixed(2)}, Lon: ${lon.toFixed(2)}) - Curve: ${titleCurve}`,
          },
        },
        scales: {
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 45,
              // biome-ignore lint/suspicious/noExplicitAny: ChartJS callback type
              callback: (_val: any, index: number) => labels[index],
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
      const buffer = await canvas.renderToBuffer(configuration);

      let filename = options.output;
      if (!filename) {
        const dateStr = date.toISOString().split('T')[0];
        filename = `schedule-${dateStr}.png`;
      }

      if (!filename.toLowerCase().endsWith('.png')) {
        filename += '.png';
      }

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
