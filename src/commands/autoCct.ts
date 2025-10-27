import chalk from 'chalk';
import type { Command } from 'commander';
import type LightController from '../lightControl';

export interface CommandDeps {
  createController: (
    wsUrl?: string,
    clientId?: string,
    debug?: boolean
  ) => Promise<LightController>;
  findDevice: (controller: LightController, deviceQuery: string) => unknown;
  asyncCommand: (fn: (...args: unknown[]) => Promise<unknown>) => (...args: unknown[]) => void;
  saveWsUrl?: (url: string) => void;
  loadConfig?: () => Record<string, unknown>;
}

export function registerAutoCct(program: Command, deps: CommandDeps) {
  const { createController, asyncCommand, loadConfig } = deps;

  program
    .command('auto-cct')
    .description('Set CCT for all lights based on current location and time (geoip)')
    .option('-u, --url <url>', 'WebSocket URL')
    .option('-c, --client-id <id>', 'Client ID')
    .option('-d, --debug', 'Enable debug mode')
    .option('--ip <ip>', 'Override IP address for geoip lookup')
    .option('--lat <latitude>', 'Manual latitude (-90 to 90)')
    .option('--lon <longitude>', 'Manual longitude (-180 to 180)')
    .option('--time <time>', 'Manual time (ISO 8601 format, e.g., 2025-10-26T14:30:00)')
    .action(
      asyncCommand(async (...args: unknown[]) => {
        const optionsRaw = (args[0] ?? {}) as Record<string, unknown>;
        const { getLocationFromIP } = await import('../geoipUtil');
        const { calculateCCT } = await import('../cctUtil');
        const options = optionsRaw as {
          url?: string;
          clientId?: string;
          debug?: boolean;
          ip?: string;
          lat?: string;
          lon?: string;
          time?: string;
        };
        const controller = await createController(options.url, options.clientId, options.debug);

        let lat: number | undefined;
        let lon: number | undefined;
        let time: Date = new Date();
        let source = '';

        if (options.time) {
          time = new Date(options.time);
          if (Number.isNaN(time.getTime())) {
            console.error(
              chalk.red('Invalid time format. Use ISO 8601 format (e.g., 2025-10-26T14:30:00)')
            );
            process.exit(1);
          }
        }

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
          const storedLat = config.latitude;
          const storedLon = config.longitude;
          if (typeof storedLat === 'number' && typeof storedLon === 'number') {
            lat = storedLat;
            lon = storedLon;
            source = 'config';
          }
        }

        if (lat === undefined || lon === undefined) {
          let ip = options.ip;
          if (!ip) {
            try {
              const res = await fetch('https://api.ipify.org?format=json');
              const data = await res.json();
              ip = data.ip;
            } catch (_err) {
              ip = '127.0.0.1';
            }
          }
          const location = getLocationFromIP(ip);
          if (!location || !location.ll) {
            console.error(
              chalk.red(
                'Could not determine location from IP. Use --lat and --lon to specify manually, or set defaults with: amaran config --lat <lat> --lon <lon>'
              )
            );
            process.exit(1);
          }
          [lat, lon] = location.ll;
          source = `geoip (${ip})`;
        }

        // Load optional bounds from config; fall back to built-in defaults for auto-cct
        const cfg = (typeof loadConfig === 'function' ? (loadConfig() ?? {}) : {}) as Record<
          string,
          unknown
        >;
        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

        const minKRaw = cfg.cctMin;
        const maxKRaw = cfg.cctMax;
        const minKCfg = typeof minKRaw === 'number' ? minKRaw : undefined;
        const maxKCfg = typeof maxKRaw === 'number' ? maxKRaw : undefined;
        const loK = minKCfg !== undefined ? clamp(minKCfg, 1000, 20000) : 2000;
        const hiK = maxKCfg !== undefined ? clamp(maxKCfg, 1000, 20000) : 6500;

        // For auto-cct defaults: use 5–100% if not configured
        const minPctRaw = cfg.intensityMin;
        const maxPctRaw = cfg.intensityMax;
        const minPctCfg = typeof minPctRaw === 'number' ? minPctRaw : 5;
        const maxPctCfg = typeof maxPctRaw === 'number' ? maxPctRaw : 100;
        const loPct = clamp(Math.min(minPctCfg, maxPctCfg), 0, 100);
        const hiPct = clamp(Math.max(minPctCfg, maxPctCfg), 0, 100);

        const result = calculateCCT(lat, lon, time, {
          cctMinK: Math.min(loK, hiK),
          cctMaxK: Math.max(loK, hiK),
          intensityMinPct: loPct,
          intensityMaxPct: hiPct,
        });

        const percent = Math.round((result.intensity / 10) * 10) / 10;
        console.log(chalk.blue(`Setting CCT to ${result.cct}K at ${percent}% for active lights`));
        console.log(chalk.gray(`  Location: ${lat.toFixed(4)}, ${lon.toFixed(4)} (${source})`));
        console.log(chalk.gray(`  Time: ${time.toISOString()}`));

        const devices = controller.getDevices?.() ?? [];
        const lightPattern = /^[A-Z0-9]+-[A-Z0-9]+$/i;
        type LightDevice = {
          node_id: string;
          device_name?: string;
          name?: string;
          id?: string;
          [key: string]: unknown;
        };

        const lightDevices = (devices as unknown[]).filter((device): device is LightDevice => {
          if (!device || typeof device !== 'object') {
            return false;
          }
          const candidate = device as { node_id?: unknown };
          return typeof candidate.node_id === 'string' && lightPattern.test(candidate.node_id);
        });

        if (lightDevices.length === 0) {
          console.log(chalk.yellow('No light devices found; skipping auto CCT update.'));
          await controller.disconnect();
          return;
        }

        const waitMs = 250;
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

            controller.getLightSleepStatus?.(
              nodeId,
              (success: boolean, _message: string, data?: { sleep?: unknown; data?: unknown }) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                if (!success) {
                  resolve(undefined);
                  return;
                }
                // Normalize various possible representations of sleep state
                if (data) {
                  // Direct sleep field
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
                  // Server may return { data: boolean }
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
              }
            );
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
            console.log(
              chalk.gray(`  Skipped ${offDevices.length} light(s) to avoid turning them on.`)
            );
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
          console.log(
            `  Setting ${displayName} (${device.node_id}) to ${result.cct}K at ${percent}%`
          );
          controller.setCCT(device.node_id, result.cct, result.intensity);
          if (i < activeDevices.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
        }
        await controller.disconnect();
      })
    );
}

export default registerAutoCct;
