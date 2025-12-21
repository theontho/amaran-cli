import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { Schedule } from './scheduleMaker.js';

export interface GraphScheduleOptions {
  width?: number;
  height?: number;
  metrics?: 'cct' | 'intensity' | 'lux' | 'both' | 'all';
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

const COLORS = [
  'rgb(54, 162, 235)', // Blue
  'rgb(255, 99, 132)', // Red
  'rgb(75, 192, 192)', // Teal
  'rgb(255, 205, 86)', // Yellow
  'rgb(153, 102, 255)', // Purple
  'rgb(255, 159, 64)', // Orange
  'rgb(75, 192, 75)', // Green
  'rgb(255, 0, 255)', // Magenta
];

export async function graphSchedule(schedule: Schedule, options: GraphScheduleOptions = {}): Promise<Buffer> {
  const width = options.width || 1200;
  const height = options.height || 600;
  const metrics = options.metrics || 'both';

  const canvas = new ChartJSNodeCanvas({ width, height });

  const datasets: ChartDataset[] = [];
  const labels: string[] = schedule.points.map((p) => {
    if (p.time.getMinutes() === 0) {
      return p.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return '';
  });

  const showIntensity = metrics === 'intensity' || metrics === 'both' || metrics === 'all';
  const showCct = metrics === 'cct' || metrics === 'both' || metrics === 'all';
  const showLux = metrics === 'lux' || metrics === 'all';

  schedule.curves.forEach((curve, index) => {
    const color = schedule.curves.length > 1 ? COLORS[index % COLORS.length] : 'rgb(54, 162, 235)';
    const cctColor = schedule.curves.length > 1 ? COLORS[(index + 1) % COLORS.length] : 'rgb(255, 99, 132)';
    const luxColor = schedule.curves.length > 1 ? COLORS[(index + 2) % COLORS.length] : 'rgb(75, 192, 75)';

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

    if (showLux) {
      datasets.push({
        label: schedule.curves.length > 1 ? `${curve} (Lux)` : 'Light Output (Lux)',
        data: schedule.points.map((p) => p.values.get(curve)?.lightOutput ?? 0),
        borderColor: luxColor,
        backgroundColor: 'transparent',
        yAxisID: 'y2',
        fill: false,
        pointRadius: 0,
        borderWidth: 2,
      });
    }
  });

  const titleCurve =
    schedule.curves.length > 1 ? (schedule.curves.length === 7 ? 'All Curves' : 'Multiple Curves') : schedule.curves[0];

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
          display: showIntensity,
          position: 'left',
          title: { display: true, text: 'Intensity (%)' },
          min: 0,
          max: 100,
        },
        y1: {
          type: 'linear',
          display: showCct,
          position: 'right',
          title: { display: true, text: 'CCT (K)' },
        },
        y2: {
          type: 'linear',
          display: showLux,
          position: 'right',
          title: { display: true, text: 'Light Output (Lux)' },
          grid: { drawOnChartArea: false }, // Only show grid for left axis
          min: 0,
        },
      },
    },
  };

  // biome-ignore lint/suspicious/noExplicitAny: Chart.js configuration type is complex
  return await canvas.renderToBuffer(configuration as any);
}
