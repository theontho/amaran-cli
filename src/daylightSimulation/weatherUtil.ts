import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WeatherOptions } from './types.js';

const CACHE_FILE = path.join(process.env.HOME || '', '.amaran-cli-weather.json');
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface WeatherCache {
  lat: number;
  lon: number;
  timestamp: number;
  data: WttrResponse;
}

interface WttrResponse {
  current_condition: Array<{
    weatherCode: string;
    temp_C: string;
    weatherDesc: Array<{ value: string }>;
    localObsDateTime: string;
    [key: string]: unknown;
  }>;
  weather: Array<{
    date: string;
    hourly: Array<{
      time: string;
      weatherCode: string;
      tempC: string;
      weatherDesc: Array<{ value: string }>;
      [key: string]: unknown;
    }>;
  }>;
  [key: string]: unknown;
}

/**
 * WWO Weather Code Mapping to Cloud Cover and Precipitation
 * Based on: https://www.worldweatheronline.com/feed/wwo-weather-codes.ashx
 */
function mapWeatherCode(code: string): WeatherOptions {
  const c = parseInt(code, 10);

  // Default values
  let cloudCover = 0;
  let precipitation: WeatherOptions['precipitation'] = 'none';

  // Precipitation mapping
  if ([395, 392, 371, 368, 338, 335, 332, 329, 326, 323, 230, 227, 179].includes(c)) {
    precipitation = 'snow';
  } else if ([389, 386, 359, 356, 353, 308, 305, 302, 299, 296, 293, 176].includes(c)) {
    precipitation = 'rain';
  } else if ([284, 281, 266, 263, 185, 182, 143].includes(c)) {
    precipitation = 'drizzle';
  }

  // Cloud cover mapping (estimated)
  if ([122, 143, 248, 260].includes(c)) {
    cloudCover = 1.0; // Overcast / Fog
  } else if ([119, 200, 308, 338].includes(c)) {
    cloudCover = 0.8; // Cloudy
  } else if ([116].includes(c)) {
    cloudCover = 0.4; // Partly Cloudy
  } else if ([113].includes(c)) {
    cloudCover = 0.0; // Clear
  } else if (precipitation !== 'none') {
    cloudCover = 0.9; // If raining/snowing, usually very cloudy
  }

  return { cloudCover, precipitation };
}

function getWeatherForTime(
  data: WttrResponse,
  date: Date
): WeatherOptions & { temp_C?: string; description?: string; effectiveTime?: string; dataTimestamp?: number } {
  // Find the day
  const dateStr = date.toISOString().split('T')[0];
  const day = data.weather.find((w) => w.date === dateStr);

  if (!day) {
    const options = mapWeatherCode(data.current_condition[0].weatherCode);
    return {
      ...options,
      temp_C: data.current_condition[0].temp_C,
      description: data.current_condition[0].weatherDesc[0].value,
    };
  }

  // Find the hour - hourly is every 3 hours (0, 300, 600...)
  const targetHour = date.getHours() * 100 + date.getMinutes();
  let bestHour = day.hourly[0];
  let minDiff = Math.abs(parseInt(bestHour.time, 10) - targetHour);

  for (const h of day.hourly) {
    const diff = Math.abs(parseInt(h.time, 10) - targetHour);
    if (diff < minDiff) {
      minDiff = diff;
      bestHour = h;
    }
  }

  const options = mapWeatherCode(bestHour.weatherCode);
  return {
    ...options,
    temp_C: bestHour.tempC,
    description: bestHour.weatherDesc[0].value,
    effectiveTime: `Forecast for ${bestHour.time.padStart(4, '0').slice(0, 2)}:00`,
    dataTimestamp: new Date(`${dateStr}T${bestHour.time.padStart(4, '0').replace(/(..)(..)/, '$1:$2')}:00`).getTime(),
  };
}

export async function getWeatherData(
  lat: number,
  lon: number,
  date: Date = new Date(),
  debug = false
): Promise<
  WeatherOptions & {
    raw?: WttrResponse;
    source: 'api' | 'cache' | 'forecast';
    description?: string;
    effectiveTime?: string;
    dataTimestamp?: number;
    temp_C?: string;
  }
> {
  // Check cache first
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cacheContent = fs.readFileSync(CACHE_FILE, 'utf8');
      const cache: WeatherCache = JSON.parse(cacheContent);

      const now = Date.now();
      const isRecent = now - cache.timestamp < CACHE_TTL_MS;
      // Also check if location is roughly the same (within ~11km/0.1 degree)
      const isSameLocation = Math.abs(cache.lat - lat) < 0.1 && Math.abs(cache.lon - lon) < 0.1;

      if (isRecent && isSameLocation) {
        if (debug) console.log('Using cached weather data');

        // If the cache is more than 1 hour old, use hourly forecast for the requested time
        const ageMs = Math.abs(date.getTime() - cache.timestamp);
        if (ageMs > 60 * 60 * 1000) {
          if (debug) console.log(`Cache is ${Math.round(ageMs / 60000)}m old, using hourly forecast`);
          const forecast = getWeatherForTime(cache.data, date);
          return { ...forecast, raw: cache.data, source: 'forecast' };
        }

        const options = mapWeatherCode(cache.data.current_condition[0].weatherCode);
        return {
          ...options,
          raw: cache.data,
          source: 'cache',
          description: cache.data.current_condition[0].weatherDesc[0].value,
          effectiveTime: cache.data.current_condition[0].localObsDateTime,
          dataTimestamp: cache.timestamp,
        };
      }
    }
  } catch (err) {
    if (debug) console.error('Error reading weather cache:', err);
  }

  // Try API
  try {
    if (debug) console.log(`Fetching weather from wttr.in for ${lat},${lon}...`);
    const response = await fetch(`https://wttr.in/${lat},${lon}?format=j1`, {
      headers: { 'User-Agent': 'amaran-cli' },
    });

    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }

    const data = await response.json();

    const cacheObj: WeatherCache = {
      lat,
      lon,
      timestamp: Date.now(),
      data,
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheObj, null, 2));

    const options = mapWeatherCode(data.current_condition[0].weatherCode);
    return {
      ...options,
      raw: data,
      source: 'api',
      description: data.current_condition[0].weatherDesc[0].value,
      effectiveTime: data.current_condition[0].localObsDateTime,
      dataTimestamp: Date.now(),
    };
  } catch (err) {
    if (debug) console.error('Weather API failed:', err);

    // Last resort: try expired cache if location matches
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const cacheContent = fs.readFileSync(CACHE_FILE, 'utf8');
        const cache: WeatherCache = JSON.parse(cacheContent);
        const isSameLocation = Math.abs(cache.lat - lat) < 0.1 && Math.abs(cache.lon - lon) < 0.1;

        if (isSameLocation) {
          if (debug) console.log('API failed, using expired cache for same location');
          const forecast = getWeatherForTime(cache.data, date);
          return { ...forecast, raw: cache.data, source: 'forecast' };
        }
      }
    } catch (_innerErr) {
      // Ignore inner error
    }

    // If all else fails
    return { cloudCover: 0, precipitation: 'none', source: 'cache' };
  }
}
