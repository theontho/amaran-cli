import chalk from 'chalk';
import { SPECIAL_TIME_CONFIG } from './constants.js';
import type { Schedule } from './scheduleMaker.js';

export interface TextScheduleOptions {
  csv?: boolean;
  private?: boolean;
  interval?: string;
  stripAnsi?: boolean;
}

// Helper function to get color and emoji for a special time
function getSpecialTimeStyling(
  currentTime: Date,
  times: Record<string, Date | null | undefined>
): { color: (text: string) => string; emoji: string } {
  const isSpecialTime = (specialTime: Date | null | undefined) => {
    if (!specialTime || Number.isNaN(specialTime.getTime())) return false;
    return Math.abs(currentTime.getTime() - specialTime.getTime()) < 30000; // 30 seconds
  };

  for (const config of SPECIAL_TIME_CONFIG) {
    if (isSpecialTime(times[config.key])) {
      return { color: config.color, emoji: config.emoji };
    }
  }

  return { color: chalk.white, emoji: '' };
}

const formatCoordinate = (coord: number, isPrivate: boolean) => {
  return isPrivate ? `${Math.round(coord)}.XXXX` : coord.toFixed(4);
};

const formatSource = (src: string, isPrivate: boolean) => {
  if (!isPrivate || !src.includes('(')) return src;
  const ipMatch = src.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (ipMatch) {
    const ipParts = ipMatch[1].split('.');
    ipParts[0] = 'XXX';
    ipParts[1] = 'XXX';
    ipParts[2] = 'XXX';
    return src.replace(ipMatch[1], ipParts.join('.'));
  }
  return src;
};

const formatTitle = (key: string): string => {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^([a-z])/, (c) => c.toUpperCase())
    .trim();
};

const stripAnsiCodes = (message: string) => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional use for ANSI stripping
  return message.replace(/\u001b\[\d+m/g, '');
};

export function textSchedule(schedule: Schedule, options: TextScheduleOptions = {}): string {
  const lines: string[] = [];
  const isPrivate = options.private !== false;
  const { csv, interval, stripAnsi } = options;

  const push = (message: string) => {
    lines.push(stripAnsi ? stripAnsiCodes(message) : message);
  };

  if (csv) {
    // CSV Output
    const header = ['DateTime', 'Location', 'Event'];
    schedule.curves.forEach((c) => {
      header.push(`${c}_CCT`, `${c}_Intensity`);
    });
    push(header.join(','));

    for (const point of schedule.points) {
      const dateTimeStr = point.time.toISOString();
      const locationStr = `${schedule.lat},${schedule.lon}`;
      const eventName = point.eventName ? formatTitle(point.eventName) : '';
      const row = [dateTimeStr, `"${locationStr}"`, eventName];

      schedule.curves.forEach((curve) => {
        const val = point.values.get(curve);
        row.push(val?.cct.toString() ?? '', val ? (val.intensity / 10).toFixed(1) : '');
      });
      push(row.join(','));
    }
  } else {
    // Standard Output
    push(chalk.blue('\n═══════════════════════════════════════════════════════════'));
    push(chalk.blue('               Auto-CCT Schedule Preview'));
    push(chalk.blue('═══════════════════════════════════════════════════════════\n'));

    push(
      chalk.cyan(
        `Location: ${formatCoordinate(schedule.lat, isPrivate)}°, ${formatCoordinate(schedule.lon, isPrivate)}° (${formatSource(schedule.source, isPrivate)})`
      )
    );
    push(
      chalk.cyan(
        `Date: ${schedule.date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
      )
    );
    push(chalk.cyan(`Interval: Every ${interval ?? '30'} minute${interval !== '1' ? 's' : ''}`));
    push(
      chalk.cyan(
        schedule.curves.length > 1
          ? `Curve: Multiple curves selected\n`
          : `Curve: ${schedule.curves[0].toLowerCase()}\n`
      )
    );

    const allSpecialTimes = [
      ...SPECIAL_TIME_CONFIG.map((conf) => ({
        key: conf.key,
        emoji: conf.emoji,
        color: conf.color,
        time: schedule.times[conf.key],
      })),
      { key: 'nadir', emoji: 'NA', color: chalk.blue, time: schedule.times.nadir },
    ].filter((item) => item.time && !Number.isNaN(item.time.getTime()));

    const halfLength = Math.ceil(allSpecialTimes.length / 2);
    for (let i = 0; i < halfLength; i++) {
      const left = allSpecialTimes[i];
      const right = allSpecialTimes[i + halfLength];
      let line = '';
      if (left?.time) {
        const timeStr = left.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        line += left.color(`${`${left.emoji} ${formatTitle(left.key)}`.padEnd(20)}: ${timeStr}`);
      }
      if (right?.time) {
        const timeStr = right.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        line += `   ${right.color(`${`${right.emoji} ${formatTitle(right.key)}`.padEnd(20)}: ${timeStr}`)}`;
      }
      push(line);
    }
    push(chalk.blue('\n'));

    if (schedule.curves.length > 1) {
      const headers = [
        'Time',
        ...schedule.curves.map((c) => {
          switch (c) {
            case 'WIDER_MIDDLE_SMALL':
              return 'WM_SML';
            case 'WIDER_MIDDLE_MEDIUM':
              return 'WM_MED';
            case 'WIDER_MIDDLE_LARGE':
              return 'WM_LRG';
            case 'CIE_DAYLIGHT':
              return 'CIE';
            case 'SUN_ALTITUDE':
              return 'SUN_ALT';
            case 'PEREZ_DAYLIGHT':
              return 'PEREZ';
            case 'PHYSICS':
              return 'PHYS';
            case 'BLACKBODY':
              return 'BLACK';
            case 'HAZY':
              return 'HAZY';
            default:
              return c.replace(/_/g, ' ');
          }
        }),
      ];
      const colWidths = [13, ...schedule.curves.map(() => 12)];
      const totalWidth = colWidths.reduce((a, b) => a + b, 0);

      let headerLine = '';
      headers.forEach((h, i) => {
        headerLine += h.padEnd(colWidths[i]);
      });
      push(chalk.blue('─'.repeat(totalWidth)));
      push(chalk.blue(headerLine));
      push(chalk.blue('─'.repeat(totalWidth)));

      for (const point of schedule.points) {
        const timeStr = point.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const { color, emoji } = getSpecialTimeStyling(point.time, schedule.times);
        let rowLine = color(`${timeStr} ${emoji || '  '}  `);
        schedule.curves.forEach((curve, index) => {
          const val = point.values.get(curve);
          const valStr = val ? `${val.cct}K/${(val.intensity / 10).toFixed(0)}%` : '';
          rowLine += color(valStr.padEnd(colWidths[index + 1]));
        });
        push(rowLine);
      }
      push(chalk.blue(`${'─'.repeat(totalWidth)}\n`));
    } else {
      const singleCurveWidth = 31;
      push(chalk.blue('─'.repeat(singleCurveWidth)));
      push(chalk.blue('Time           CCT/Intensity'));
      push(chalk.blue('─'.repeat(singleCurveWidth)));

      for (const point of schedule.points) {
        const val = point.values.get(schedule.curves[0]);
        const timeStr = point.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const valStr = val ? `${val.cct}K/${(val.intensity / 10).toFixed(0)}%`.padEnd(18) : '';
        const { color, emoji } = getSpecialTimeStyling(point.time, schedule.times);
        push(color(`${timeStr} ${emoji || '  '}    ${valStr}`));
      }
      push(chalk.blue(`${'─'.repeat(singleCurveWidth)}\n`));
    }
  }

  return lines.join('\n');
}
