import chalk from 'chalk';
import type { Command } from 'commander';
import { VALIDATION_RANGES } from '../../deviceControl/constants.js';
import type { CommandDeps, CommandOptions, Device } from '../../deviceControl/types.js';
import {
  addStandardOptions,
  commandCallbackPromise,
  getAppliedNumber,
  getLightDevices,
  runDeviceAction,
} from '../cmdUtils.js';

export function registerCct(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  addStandardOptions(
    program
      .command('cct [temperature] [device]')
      .usage('[temperature] [device] [options]')
      .description(
        `Set or get color temperature in Kelvin (${VALIDATION_RANGES.cct.min}-${VALIDATION_RANGES.cct.max}). Omit device or use "all" for all lights.`
      )
  )
    .option(
      '-i, --intensity <value>',
      `Also set intensity (${VALIDATION_RANGES.intensity.min}-${VALIDATION_RANGES.intensity.max})`
    )
    .option('-g, --get', 'Get current CCT and intensity instead of setting')
    .option('--relative', 'Apply a signed Kelvin change within each fixture range (requires CCT mode)')
    .action(asyncCommand(handleCct(deps)));
}

function handleCct(deps: CommandDeps) {
  return async (tempStr: string | undefined, deviceQuery: string | undefined, options: CommandOptions) => {
    if (options.get) {
      const targetDevice = deviceQuery ?? tempStr;

      return runDeviceAction(
        {
          deps,
          options,
          deviceQuery: targetDevice,
          actionName: 'get temperature',
        },
        async (device, controller) => {
          return new Promise((resolve) => {
            controller.getCCT(device.node_id as string, (success, message, data) => {
              const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
              if (!success) {
                console.error(chalk.red(`✗ ${displayName}: Failed to get CCT: ${message}`));
                resolve();
                return;
              }

              // Handle potential nesting: { data: { data: 1700 } } or { data: { cct: 1700 } }
              let state = data;
              if (state && typeof state === 'object' && 'data' in state) {
                const innerData = (state as { data: unknown }).data;
                // If nested data is just a number, that's our CCT
                if (typeof innerData === 'number') {
                  state = { cct: innerData };
                } else {
                  state = innerData;
                }
              }

              // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
              const s = state as any;
              // Some servers return the value directly or in a 'cct' property
              const cctValue = typeof state === 'number' ? state : s?.cct;

              let output = `✓ ${displayName}: ${cctValue || 'unknown'}K`;
              if (s?.intensity !== undefined) {
                output += ` at ${s.intensity / 10}% intensity`;
              }
              console.log(chalk.green(output));
              resolve();
            });
          });
        },
        async (controller) => {
          const devices = controller.getDevices();
          if (devices.length === 0) {
            console.log(chalk.yellow('No devices found'));
            return;
          }

          // Filter for light devices only, skipping groups like 'ALL'
          const lightDevices = getLightDevices(devices);

          if (lightDevices.length === 0) {
            console.log(chalk.yellow('No light devices found'));
            return;
          }

          for (const device of lightDevices) {
            if (device.node_id) {
              await new Promise<void>((resolve) => {
                controller.getCCT(device.node_id as string, (success, message, data) => {
                  const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
                  if (success) {
                    let state = data;
                    if (state && typeof state === 'object' && 'data' in state) {
                      const innerData = (state as { data: unknown }).data;
                      if (typeof innerData === 'number') {
                        state = { cct: innerData };
                      } else {
                        state = innerData;
                      }
                    }
                    // biome-ignore lint/suspicious/noExplicitAny: Data from server is dynamic
                    const s = state as any;
                    const cctValue = typeof state === 'number' ? state : s?.cct;

                    let output = `✓ ${displayName}: ${cctValue || 'unknown'}K`;
                    if (s?.intensity !== undefined) {
                      output += ` at ${s.intensity / 10}% intensity`;
                    }
                    console.log(chalk.green(output));
                  } else {
                    console.error(chalk.red(`✗ ${displayName}: Failed to get CCT: ${message}`));
                  }
                  resolve();
                });
              });
            }
          }
        }
      );
    }

    if (!tempStr) {
      console.error(chalk.red('Error: temperature is required unless using --get'));
      process.exit(1);
    }

    const temperature = Number(tempStr);
    if (
      !Number.isFinite(temperature) ||
      temperature < (options.relative ? -7500 : VALIDATION_RANGES.cct.min) ||
      temperature > (options.relative ? 7500 : VALIDATION_RANGES.cct.max)
    ) {
      console.error(
        chalk.red(
          options.relative
            ? 'Relative CCT must be between -7500K and 7500K'
            : `Temperature must be between ${VALIDATION_RANGES.cct.min}K and ${VALIDATION_RANGES.cct.max}K`
        )
      );
      process.exit(1);
    }

    let intensity: number | undefined;
    if (options.intensity) {
      intensity = parseInt(options.intensity as string, 10);
      if (
        Number.isNaN(intensity) ||
        intensity < VALIDATION_RANGES.intensity.min ||
        intensity > VALIDATION_RANGES.intensity.max
      ) {
        console.error(
          chalk.red(
            `Intensity must be a number between ${VALIDATION_RANGES.intensity.min} and ${VALIDATION_RANGES.intensity.max}`
          )
        );
        process.exit(1);
      }
      intensity = intensity * 10;
    }

    let appliedTemperature = temperature;
    let appliedIntensity = intensity;
    let observedTemperature = false;
    return runDeviceAction(
      {
        deps,
        options,
        deviceQuery,
        actionName: 'set temperature',
        onSuccess: (device: Device) => {
          const displayName = device.device_name || device.name || device.id || device.node_id || 'Unknown';
          let msg = options.relative
            ? `✓ ${displayName} temperature adjusted${observedTemperature ? ` to ${appliedTemperature}K` : ''} (relative request ${temperature}K)`
            : `✓ ${displayName} temperature set to ${appliedTemperature}K`;
          if (!options.relative && appliedTemperature !== temperature) msg += ` (rounded from ${temperature}K)`;
          if (intensity !== undefined) {
            msg += ` at ${(appliedIntensity ?? intensity) / 10}% intensity`;
          }
          return msg;
        },
      },
      (device, controller) => {
        return commandCallbackPromise((callback) => {
          const apply = options.relative
            ? controller.incrementCCT.bind(controller)
            : controller.setCCT.bind(controller);
          apply(device.node_id as string, temperature, intensity, (success, message, data) => {
            if (success && device.backend === 'ble' && data && typeof data === 'object') {
              const cct = getAppliedNumber(data, 'cct');
              if (cct !== undefined) {
                appliedTemperature = cct;
                observedTemperature = true;
              }
              appliedIntensity = getAppliedNumber(data, 'intensity') ?? appliedIntensity;
            }
            callback(success, message, data);
          });
        });
      },
      async (controller) => {
        const apply = options.relative
          ? controller.incrementCCTForAllLights.bind(controller)
          : controller.setCCTAndIntensityForAllLights.bind(controller);
        await apply(temperature, intensity, (success, message) => {
          if (!success) {
            process.exitCode = 1;
            console.error(`✗ Failed to set temperature: ${message}`);
          }
        });
      }
    );
  };
}

export default registerCct;
