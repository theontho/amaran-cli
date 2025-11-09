import chalk from 'chalk';
import type { Command } from 'commander';
import type { CommandDeps, Config } from '../types';

interface ConfigOptions {
  url?: string;
  clientId?: string;
  debug?: string;
  lat?: string;
  lon?: string;
  cctMin?: string;
  cctMax?: string;
  intensityMin?: string;
  intensityMax?: string;
  intensityMultiplier?: string; // key=value pair, e.g. AAA-333=0.8
  defaultCurve?: string;
  autoStartApp?: string;
  show?: boolean;
}

export default function registerConfig(program: Command, deps: CommandDeps) {
  const { loadConfig, saveConfig } = deps;

  if (!loadConfig) {
    throw new Error('loadConfig dependency is required');
  }

  program
    .command('config')
    .description('Configure WebSocket URL and other settings')
    .option('-u, --url <url>', 'WebSocket URL (default: ws://localhost:60124)')
    .option('-c, --client-id <id>', 'Client ID (default: amaran-cli)')
    .option('-d, --debug <boolean>', 'Enable debug mode')
    .option('--lat <latitude>', 'Default latitude for auto-cct (overrides geoip)')
    .option('--lon <longitude>', 'Default longitude for auto-cct (overrides geoip)')
    .option('--cct-min <kelvin>', 'Minimum CCT for auto-cct in Kelvin (default: 2000)')
    .option('--cct-max <kelvin>', 'Maximum CCT for auto-cct in Kelvin (default: 6500)')
    .option('--intensity-min <percent>', 'Minimum intensity for auto-cct in percent (default: 5)')
    .option('--intensity-max <percent>', 'Maximum intensity for auto-cct in percent (default: 100)')
    .option(
      '--intensity-multiplier <lightId=multiplier>',
      'Set per-light intensity multiplier for auto-cct (e.g. AAA-333=0.8). Default is 1.0 when unset.'
    )
    .option(
      '--default-curve <curve>',
      'Default curve type (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight)'
    )
    .option(
      '--auto-start-app <boolean>',
      'Automatically start Amaran desktop app on connection failure (default: true)'
    )
    .option('--show', 'Show current configuration')
    .action(async (options: ConfigOptions) => {
      if (options.show) {
        const config = loadConfig();
        console.log(chalk.blue('Current configuration:'));
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      const config: Config = loadConfig() || {};
      const changes: string[] = [];

      if (options.url) {
        config.wsUrl = options.url;
        changes.push(`WebSocket URL: ${options.url}`);
      }
      if (options.clientId) {
        config.clientId = options.clientId;
        changes.push(`Client ID: ${options.clientId}`);
      }
      if (options.debug !== undefined) {
        const value = options.debug;
        if (typeof value === 'boolean') {
          config.debug = value;
        } else {
          const lowerValue = value.toLowerCase().trim();
          if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
            config.debug = true;
          } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
            config.debug = false;
          } else {
            console.error(chalk.red('debug must be true or false'));
            process.exit(1);
          }
        }
        changes.push(`Debug mode: ${config.debug ? 'enabled' : 'disabled'}`);
      }
      if (options.lat !== undefined) {
        const lat = parseFloat(options.lat);
        if (Number.isNaN(lat) || lat < -90 || lat > 90) {
          console.error(chalk.red('Latitude must be between -90 and 90'));
          process.exit(1);
        }
        config.latitude = lat;
        changes.push(`Latitude: ${lat}`);
      }
      if (options.lon !== undefined) {
        const lon = parseFloat(options.lon);
        if (Number.isNaN(lon) || lon < -180 || lon > 180) {
          console.error(chalk.red('Longitude must be between -180 and 180'));
          process.exit(1);
        }
        config.longitude = lon;
        changes.push(`Longitude: ${lon}`);
      }

      // Bounds validation helpers
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      if (options.cctMin !== undefined) {
        const k = parseInt(options.cctMin, 10);
        if (Number.isNaN(k)) {
          console.error(chalk.red('cct-min must be a number (Kelvin)'));
          process.exit(1);
        }
        config.cctMin = clamp(k, 1000, 20000);
        changes.push(`CCT minimum: ${config.cctMin}K`);
      }
      if (options.cctMax !== undefined) {
        const k = parseInt(options.cctMax, 10);
        if (Number.isNaN(k)) {
          console.error(chalk.red('cct-max must be a number (Kelvin)'));
          process.exit(1);
        }
        config.cctMax = clamp(k, 1000, 20000);
        changes.push(`CCT maximum: ${config.cctMax}K`);
      }
      if (options.intensityMin !== undefined) {
        const p = parseFloat(options.intensityMin);
        if (Number.isNaN(p)) {
          console.error(chalk.red('intensity-min must be a number (percent)'));
          process.exit(1);
        }
        config.intensityMin = clamp(p, 0, 100);
        changes.push(`Intensity minimum: ${config.intensityMin}%`);
      }
      if (options.intensityMax !== undefined) {
        const p = parseFloat(options.intensityMax);
        if (Number.isNaN(p)) {
          console.error(chalk.red('intensity-max must be a number (percent)'));
          process.exit(1);
        }
        config.intensityMax = clamp(p, 0, 100);
        changes.push(`Intensity maximum: ${config.intensityMax}%`);
      }

      // Per-light intensity multiplier mapping (single pair per invocation)
      if (options.intensityMultiplier !== undefined) {
        const pair = options.intensityMultiplier.trim();
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          console.error(chalk.red('intensity-multiplier must be in the form <lightId>=<multiplier>, e.g. AAA-333=0.8'));
          process.exit(1);
        }
        const lightId = pair.slice(0, eqIdx).trim();
        const valueStr = pair.slice(eqIdx + 1).trim();
        if (!lightId) {
          console.error(chalk.red('intensity-multiplier: lightId cannot be empty'));
          process.exit(1);
        }
        const mult = parseFloat(valueStr);
        if (Number.isNaN(mult)) {
          console.error(chalk.red('intensity-multiplier value must be a number (e.g. 0.8 for 80%)'));
          process.exit(1);
        }
        if (mult < 0 || mult > 1) {
          console.error(chalk.red('intensity-multiplier must be between 0 and 1 (e.g. 0.8 for 80%)'));
          process.exit(1);
        }
        if (!config.intensityMultiplier || typeof config.intensityMultiplier !== 'object') {
          (config as Config).intensityMultiplier = {} as Record<string, number>;
        }
        (config.intensityMultiplier as Record<string, number>)[lightId] = mult;
        changes.push(`Intensity multiplier for ${lightId}: ${mult}`);
      }

      // Handle default curve option
      if (options.defaultCurve !== undefined) {
        const { parseCurveType } = await import('../cctUtil');
        try {
          parseCurveType(options.defaultCurve);
          config.defaultCurve = options.defaultCurve;
          changes.push(`Default curve: ${config.defaultCurve}`);
        } catch (error) {
          console.error(chalk.red((error as Error).message));
          process.exit(1);
        }
      }

      // Handle auto-start-app option
      if (options.autoStartApp !== undefined) {
        const value = options.autoStartApp;
        if (typeof value === 'boolean') {
          config.autoStartApp = value;
        } else {
          const lowerValue = value.toLowerCase().trim();
          if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on') {
            config.autoStartApp = true;
          } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off') {
            config.autoStartApp = false;
          } else {
            console.error(chalk.red('auto-start-app must be true or false'));
            process.exit(1);
          }
        }
        changes.push(`Auto-start app: ${config.autoStartApp ? 'enabled' : 'disabled'}`);
      }

      // Ensure logical ordering if both sides provided
      if (
        config.cctMin !== undefined &&
        config.cctMax !== undefined &&
        config.cctMin !== null &&
        config.cctMax !== null &&
        config.cctMin > config.cctMax
      ) {
        console.error(chalk.red('cct-min must be <= cct-max'));
        process.exit(1);
      }
      if (
        config.intensityMin !== undefined &&
        config.intensityMin !== null &&
        config.intensityMax !== undefined &&
        config.intensityMax !== null &&
        config.intensityMin > config.intensityMax
      ) {
        console.error(chalk.red('intensity-min must be <= intensity-max'));
        process.exit(1);
      }

      // Save the config using provided deps if available, otherwise fallback to local write
      if (typeof saveConfig === 'function') {
        saveConfig(config, changes);
      } else {
        const fs = require('node:fs');
        const path = require('node:path');
        const configPath = path.join(process.env.HOME || '', '.amaran-cli.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        if (changes && changes.length > 0) {
          console.log(chalk.green('Configuration saved successfully:'));
          changes.forEach((change) => {
            console.log(chalk.green(`  • ${change}`));
          });
        } else {
          console.log(chalk.green('Configuration saved successfully'));
        }
      }
    });
}
