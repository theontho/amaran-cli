import chalk from 'chalk';
import type { Command } from 'commander';
import { FanStatesSchema } from '../../ble/fan.js';
import { FAN_MODES, type FanMode, type FanState, parseFanMode, validateFanRpm } from '../../ble/telink.js';
import BleHttpController from '../../deviceControl/bleHttpControl.js';
import type { CommandDeps, CommandOptions, Device, LightController } from '../../deviceControl/types.js';
import { addStandardOptions, commandCallbackResult, getLightDevices, runDeviceAction } from '../cmdUtils.js';

export function registerFan(program: Command, deps: CommandDeps) {
  const fan = program
    .command('fan')
    .description('Native fan profiles and thermal telemetry for fixtures, groups or all');
  addStandardOptions(
    fan
      .command('mode <device> <mode>')
      .description('manual=0, smart=1, max=2, off=3, high=4, medium=5, low=6, silent=7; requires advertised support')
      .option('--rpm <rpm>', 'Required for manual mode: integer 0-65535; zero requires LEDs off')
      .option('--json', 'Output keyed BLE fan states as JSON')
  ).action(
    deps.asyncCommand(async (device: string, value: string, options: CommandOptions) => {
      const mode = parseFanMode(value);
      const input = typeof options.rpm === 'string' && options.rpm.trim() ? Number(options.rpm) : options.rpm;
      const rpm = validateFanRpm(mode, input);
      await fanAction(deps, options, device, mode, rpm);
    })
  );
  addStandardOptions(
    fan
      .command('info [device]')
      .description('Read fan mode, reported RPM, temperature and protection status; defaults to all')
      .option('--json', 'Output keyed BLE fan states as JSON')
  ).action(
    deps.asyncCommand(async (device: string | undefined, options: CommandOptions) => {
      await fanAction(deps, options, device);
    })
  );
  addStandardOptions(
    fan
      .command('speed <device> <speed>')
      .description('Select manual mode with the requested RPM (0-65535); requires advertised manual support')
      .option('--json', 'Output keyed BLE fan states as JSON')
  ).action(
    deps.asyncCommand(async (device: string, value: string, options: CommandOptions) => {
      const rpm = validateFanRpm('manual', value.trim() ? Number(value) : NaN);
      await fanAction(deps, options, device, 'manual', rpm);
    })
  );
}

function printFan(name: string, state: FanState, desired?: FanMode): void {
  if (desired !== undefined)
    console.log(chalk.green(`Fan mode set to ${state.mode} (${state.modeName ?? desired}) on ${name}`));
  else console.log(chalk.blue(`Fan Information for ${name}:`));
  console.log(`  Mode: ${state.modeName ?? 'unknown'} (${state.mode})`);
  console.log(
    `  Reported RPM: ${state.speed}${state.speed === 0 ? ' (zero reported; not a confirmed fan fault)' : ''}`
  );
  console.log(`  Reported temperature: ${state.temperature}`);
  console.log(
    `  Thermal protection: ${state.highTemperature ? chalk.red('ACTIVE - allow cooling; do not restart') : 'not active'}`
  );
  console.log(`  Available profiles: ${state.allowedModes?.join(', ') || 'none reported'}`);
  const unsupported = Object.keys(FAN_MODES).filter((mode) => !state.supported[parseFanMode(mode)]);
  if (unsupported.length) console.log(`  Not advertised by this fixture: ${unsupported.join(', ')}`);
}

async function fanAction(
  deps: CommandDeps,
  options: CommandOptions,
  deviceQuery?: string,
  desired?: FanMode,
  rpm?: number
) {
  const work = async (controller: LightController, device?: Device) => {
    if (controller instanceof BleHttpController) {
      const result = FanStatesSchema.parse(
        await commandCallbackResult((callback) =>
          controller.fanStates(device ? [device.node_id as string] : 'all', desired, callback, rpm)
        )
      );
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else
        for (const [key, state] of Object.entries(result.states)) {
          const light = controller.getDevices().find((entry) => entry.node_id === key);
          printFan(String(light?.device_name ?? key), state, desired);
        }
      return;
    }
    if (options.json) throw new Error('Structured fan telemetry requires --backend ble');
    if (desired && ['manual', 'off', 'low', 'silent'].includes(desired))
      throw new Error('Extended fan modes require --backend ble for capability and safety checks');
    const lights = device ? [device] : getLightDevices(controller.getDevices());
    if (!lights.length) throw new Error('No lights available for fan control');
    for (const light of lights) {
      const key = light.node_id;
      if (!key) throw new Error('Fan target has no node ID');
      if (desired !== undefined) {
        await commandCallbackResult((callback) => controller.setFanMode(key, FAN_MODES[desired], callback));
        console.log(chalk.green(`Fan mode set to ${FAN_MODES[desired]} (${desired}) on ${light.device_name}`));
      } else {
        const mode = await commandCallbackResult((callback) => controller.getFanMode(key, callback));
        const speed = await commandCallbackResult((callback) => controller.getFanSpeed(key, callback));
        console.log(chalk.blue(`Fan Information for ${light.device_name}:`));
        console.log(`  Mode: ${mode}\n  Reported RPM: ${speed}`);
      }
    }
  };
  await runDeviceAction(
    { deps, options, deviceQuery, actionName: 'access fan settings' },
    (device, controller) => work(controller, device),
    (controller) => work(controller)
  );
}

export default registerFan;
