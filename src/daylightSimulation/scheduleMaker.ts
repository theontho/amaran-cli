import { SPECIAL_TIME_CONFIG } from './constants.js';
import type { CommandDeps } from './types.js';

export interface SchedulePoint {
  time: Date;
  values: Map<string, { cct: number; intensity: number }>;
  isSpecial: boolean;
  eventName?: string;
}

export interface Schedule {
  lat: number;
  lon: number;
  date: Date;
  source: string;
  points: SchedulePoint[];
  curves: string[];
  times: Record<string, Date | null | undefined>;
}

export interface MakeScheduleOptions {
  lat?: string;
  lon?: string;
  date?: string;
  intervalMinutes?: number;
  curves?: string; // comma separated or "all"
  includeSpecialTimes?: boolean;
  bufferMinutes?: number;
  startTime?: Date;
  endTime?: Date;
}

export class ScheduleMaker {
  private deps: CommandDeps;

  constructor(deps: CommandDeps) {
    this.deps = deps;
  }

  async makeSchedule(options: MakeScheduleOptions): Promise<Schedule> {
    const { getLocationFromIP } = await import('./geoipUtil.js');
    const { calculateCCT, CurveType, parseCurveType } = await import('./cctUtil.js');
    const SunCalc = (await import('suncalc')).default;
    const { getTimes } = SunCalc;
    const { loadConfig } = this.deps;

    let lat: number | undefined;
    let lon: number | undefined;
    const date = options.date ? new Date(options.date) : new Date();
    let source = '';

    if (options.date && Number.isNaN(date.getTime())) {
      throw new Error('Invalid date format. Use ISO format (e.g., 2025-10-26)');
    }

    // Resolve Lat/Lon
    if (options.lat !== undefined && options.lon !== undefined) {
      lat = parseFloat(options.lat);
      lon = parseFloat(options.lon);
      if (Number.isNaN(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be between -90 and 90');
      if (Number.isNaN(lon) || lon < -180 || lon > 180) throw new Error('Longitude must be between -180 and 180');
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
        if (!location || !location.ll) throw new Error('Could not determine location');
        [lat, lon] = location.ll;
        source = `geoip (${data.ip})`;
      } catch (_err) {
        throw new Error('Could not determine location. Use --lat and --lon to specify manually.');
      }
    }

    // Resolve Curves
    const allCurveTypesOrdered = [
      'HANN',
      'WIDER_MIDDLE_SMALL',
      'WIDER_MIDDLE_MEDIUM',
      'WIDER_MIDDLE_LARGE',
      'CIE_DAYLIGHT',
      'SUN_ALTITUDE',
      'PEREZ_DAYLIGHT',
    ] as (keyof typeof CurveType)[];

    let curveTypes: (keyof typeof CurveType)[] = ['HANN'];
    const curveOption = options.curves?.toLowerCase() || '';

    if (curveOption === 'all') {
      curveTypes = [...allCurveTypesOrdered];
    } else if (curveOption) {
      const parts = curveOption.split(',').map((s) => s.trim());
      const parsedList: (keyof typeof CurveType)[] = [];
      for (const part of parts) {
        if (part === 'all') {
          parsedList.push(...allCurveTypesOrdered);
        } else {
          parsedList.push(parseCurveType(part));
        }
      }
      const unique = new Set(parsedList);
      curveTypes = allCurveTypesOrdered.filter((c) => unique.has(c));
    } else if (loadConfig) {
      const config = loadConfig();
      if (config?.defaultCurve) {
        try {
          curveTypes = [parseCurveType(config.defaultCurve)];
        } catch (_) {
          curveTypes = [...allCurveTypesOrdered];
        }
      } else {
        curveTypes = [...allCurveTypesOrdered];
      }
    } else {
      curveTypes = [...allCurveTypesOrdered];
    }

    const times = getTimes(date, lat, lon);
    const specialTimesMap = new Map<number, string>();
    for (const config of SPECIAL_TIME_CONFIG) {
      const t = times[config.key as keyof typeof times];
      if (t && !Number.isNaN(t.getTime())) {
        specialTimesMap.set(t.getTime(), config.key);
      }
    }
    if (times.nadir && !Number.isNaN(times.nadir.getTime())) {
      specialTimesMap.set(times.nadir.getTime(), 'nadir');
    }

    // Determine generation bounds
    let genStart = options.startTime;
    let genEnd = options.endTime;

    if (!genStart || !genEnd) {
      const allSpecialTimesArr = Array.from(specialTimesMap.keys());
      if (allSpecialTimesArr.length === 0) throw new Error('Could not calculate special times');

      const minTime = Math.min(...allSpecialTimesArr);
      const maxTime = Math.max(...allSpecialTimesArr);
      const bufferMs = (options.bufferMinutes ?? 30) * 60 * 1000;

      if (!genStart) genStart = new Date(minTime - bufferMs);
      if (!genEnd) genEnd = new Date(maxTime + bufferMs);
    }

    const intervalMs = (options.intervalMinutes ?? 30) * 60 * 1000;
    const allTimeStamps = new Set<number>();

    // Add intervals
    let curr = genStart.getTime();
    while (curr <= genEnd.getTime()) {
      allTimeStamps.add(curr);
      curr += intervalMs;
    }

    // Add special times if requested
    if (options.includeSpecialTimes !== false) {
      for (const t of specialTimesMap.keys()) {
        if (t >= genStart.getTime() && t <= genEnd.getTime()) {
          allTimeStamps.add(t);
        }
      }
    }

    const sortedTimes = Array.from(allTimeStamps).sort((a, b) => a - b);
    const uniqueTimes: number[] = [];
    const threshold = 30000; // 30s

    for (const t of sortedTimes) {
      if (uniqueTimes.length === 0 || t - uniqueTimes[uniqueTimes.length - 1] > threshold) {
        uniqueTimes.push(t);
      }
    }

    // Load config bounds
    const cfg = (loadConfig?.() ?? {}) as Record<string, unknown>;
    const cctOpts = {
      cctMinK: typeof cfg.cctMin === 'number' ? cfg.cctMin : undefined,
      cctMaxK: typeof cfg.cctMax === 'number' ? cfg.cctMax : undefined,
      intensityMinPct: typeof cfg.intensityMin === 'number' ? cfg.intensityMin : undefined,
      intensityMaxPct: typeof cfg.intensityMax === 'number' ? cfg.intensityMax : undefined,
    };

    if (lat === undefined || lon === undefined) {
      throw new Error('Location is required for schedule points');
    }

    const points: SchedulePoint[] = uniqueTimes.map((t) => {
      const currentTime = new Date(t);
      const values = new Map<string, { cct: number; intensity: number }>();

      for (const curve of curveTypes) {
        const result = calculateCCT(lat, lon, currentTime, cctOpts, CurveType[curve]);
        values.set(curve, result);
      }

      const eventKey = specialTimesMap.get(t);
      return {
        time: currentTime,
        values,
        isSpecial: !!eventKey,
        eventName: eventKey,
      };
    });

    return {
      lat,
      lon,
      date,
      source,
      points,
      curves: curveTypes,
      times: {
        ...times,
      } as Record<string, Date | null | undefined>,
    };
  }
}
