import { setTimeout as delay } from 'node:timers/promises';
import { colorToHSI } from './colors.js';
import { readComposition } from './configuration.js';
import { desktopDeviceKeys } from './desktop.js';
import {
  COLOR_EFFECTS,
  type EffectOptions,
  effectName,
  effectPacket,
  TRIGGER_EFFECTS,
  WHITE_EFFECTS,
} from './effects.js';
import { describeFan, FanSettingSchema, FanStateSchema } from './fan.js';
import type { LocalLibrary, SteadyHistory } from './library.js';
import { NativeGroups } from './nativeGroups.js';
import type { UnprovisionedDevice } from './provisioning.js';
import type { ProductInfo } from './settings.js';
import type { MeshConfig, MeshLight } from './storage.js';
import {
  brightnessPacket,
  cctPacket,
  FAN_MODES,
  type FanMode,
  type FanState,
  type FixtureState,
  fanPacket,
  hsiPacket,
  numberInRange,
  parseFanMode,
  powerPacket,
  validateFanRpm,
} from './telink.js';
import { interpolateState } from './transitions.js';

export interface MeshLink {
  readonly ready: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(address: number, payload: Buffer): Promise<void>;
  readState(address: number): Promise<FixtureState>;
  readFan?(address: number): Promise<FanState>;
  readProductInfo?(address: number): Promise<ProductInfo>;
  configuration?(address: number, request: Buffer, accept: (data: Buffer) => boolean): Promise<Buffer>;
  discoverUnprovisioned?(): Promise<UnprovisionedDevice[]>;
}

export function capabilities(light: MeshLight) {
  return {
    cct_support: true,
    cct_min: light.model === '150c' ? 2500 : 2700,
    cct_max: light.model === '150c' ? 7500 : 6500,
    cct_step: 100,
    hsi_support: light.model === '150c',
    rgb_support: false,
    advanced_hsi_support: false,
    gm_support: light.model === '150c',
    gm_min: -100,
    gm_max: 100,
    gm_step: 10,
    fan_support: true,
    fan_policy: 'native-profile',
    intensity_step: 10,
    effects: light.model === '150c' ? COLOR_EFFECTS : WHITE_EFFECTS,
  };
}

const ARGUMENTS: Record<string, string[]> = {
  state: [],
  on: [],
  off: [],
  toggle: [],
  brightness: ['value'],
  'increment-brightness': ['delta'],
  'increment-cct': ['delta', 'brightness'],
  cct: ['kelvin', 'brightness', 'gm'],
  gm: ['value'],
  hsi: ['hue', 'saturation', 'brightness'],
  color: ['color', 'brightness'],
  effect: ['name', 'brightness', 'frequency', 'kelvin', 'gm', 'palette', 'hue', 'saturation'],
  'effect-speed': ['value'],
  'effect-intensity': ['value'],
  'effect-stop': [],
  'effect-trigger': [],
};

export function validateAction(light: MeshLight, action: string, body: Record<string, unknown>): void {
  if (!Object.hasOwn(ARGUMENTS, action)) throw new Error(`Unsupported BLE action: ${action}`);
  for (const key of Object.keys(body))
    if (!ARGUMENTS[action].includes(key)) throw new Error(`Unsupported ${action} argument: ${key}`);
  const caps = capabilities(light);
  if (action === 'brightness' || action === 'effect-intensity') numberInRange(body.value, 'brightness', 0, 100);
  if (action === 'increment-brightness') numberInRange(body.delta, 'brightness delta', -100, 100);
  if (action === 'increment-cct') numberInRange(body.delta, 'CCT delta', -7500, 7500);
  if (action === 'cct' || body.kelvin !== undefined)
    numberInRange(body.kelvin, `${light.name} CCT`, caps.cct_min, caps.cct_max);
  if (action === 'gm' || body.gm !== undefined) {
    if (!caps.gm_support) throw new Error(`${light.name} does not support G/M`);
    numberInRange(action === 'gm' ? body.value : body.gm, 'G/M', -100, 100);
  }
  if (action === 'hsi' || action === 'color') {
    if (!caps.hsi_support) throw new Error(`${light.name} does not support HSI`);
    if (action === 'color') colorToHSI(body.color);
    else {
      numberInRange(body.hue, 'hue', 0, 360);
      numberInRange(body.saturation, 'saturation', 0, 100);
    }
  }
  if (action === 'effect') {
    const name = effectName(body.name);
    if (!caps.effects.includes(name)) throw new Error(`${light.name} does not support ${name}`);
    const tint = ['paparazzi', 'lightning', 'faulty-bulb', 'pulsing', 'strobe', 'explosion'].includes(name);
    if (!tint && (body.kelvin !== undefined || body.gm !== undefined))
      throw new Error(`${name} uses a palette, not CCT/G/M parameters`);
    if (body.palette !== undefined && !['tv', 'fire', 'fireworks', 'cop-car'].includes(name))
      throw new Error(`${name} has no palette parameter`);
    if (body.hue !== undefined || (body.saturation !== undefined && name !== 'party-lights')) {
      if (!caps.hsi_support || !['faulty-bulb', 'pulsing'].includes(name))
        throw new Error(`${light.name} does not support HSI ${name}`);
      numberInRange(body.hue, 'hue', 0, 360);
      numberInRange(body.saturation, 'saturation', 0, 100);
      if (body.kelvin !== undefined || body.gm !== undefined)
        throw new Error('An HSI effect cannot also specify CCT/G/M');
    }
    if (body.saturation !== undefined) numberInRange(body.saturation, 'saturation', 0, 100);
  }
  if (action === 'effect-speed') numberInRange(body.value, 'effect frequency', 1, 10);
  if (body.frequency !== undefined) numberInRange(body.frequency, 'frequency', 1, 10);
  if (body.palette !== undefined) numberInRange(body.palette, 'palette', 0, 2);
  if (body.brightness !== undefined) numberInRange(body.brightness, 'brightness', 0, 100);
}

interface Prepared {
  light: MeshLight;
  payload: Buffer;
  expected: Partial<FixtureState>;
}
export interface BatchResult {
  delivery: 'mesh-broadcast' | 'native-group' | 'batched-unicast';
  states: Record<string, FixtureState>;
  triggerRequest?: { sent: true; eventConfirmed: false };
}
export interface CommandState extends FixtureState {
  triggerRequest?: { sent: true; eventConfirmed: false };
}

class FanThermalError extends Error {
  constructor(light: MeshLight) {
    super(
      `${light.name}: Thermal protection is active; allow the fixture to cool. No fan or light restart was attempted.`
    );
  }
}

export class VerifiedController {
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private stopping = false;
  private readonly steadyStates = new Map<string, FixtureState>();
  private readonly manualOverrides = new Map<string, number>();

  constructor(
    readonly config: MeshConfig,
    readonly link: MeshLink,
    private readonly history?: SteadyHistory
  ) {}

  async importDeviceKeys(database: string, persist: (config: MeshConfig) => void): Promise<number> {
    return this.serialize(async () => {
      if (!this.link.configuration) throw new Error('Native configuration transport is unavailable');
      const candidate = desktopDeviceKeys(database, this.config);
      const previous = this.config.lights;
      this.config.lights = candidate.lights;
      try {
        const configuration = this.link.configuration.bind(this.link);
        for (const light of candidate.lights) await readComposition({ configuration }, light.address);
        persist(this.config);
      } catch (error) {
        this.config.lights = previous;
        throw error;
      }
      return candidate.lights.length;
    });
  }

  async nativeGroup(
    library: LocalLibrary,
    key: string | undefined,
    action: 'inspect' | 'enable' | 'sync' | 'disable' | 'add' | 'remove',
    value?: number | string
  ) {
    return this.serialize(async () => {
      if (!this.link.configuration) throw new Error('Native configuration transport is unavailable');
      const groups = new NativeGroups(this.config, { configuration: this.link.configuration.bind(this.link) }, library);
      if (action === 'inspect') return groups.inspect();
      if (!key) throw new Error('Native group ID is required');
      if (action === 'enable') return groups.enable(key, typeof value === 'number' ? value : undefined);
      if (action === 'disable') return groups.disable(key);
      if (action === 'add' || action === 'remove') {
        if (typeof value !== 'string') throw new Error('Member key is required');
        return groups.member(key, value, action === 'remove');
      }
      return groups.sync(key);
    });
  }

  async discoverUnprovisioned(): Promise<UnprovisionedDevice[]> {
    if (!this.link.discoverUnprovisioned) throw new Error('Provisioning discovery is unavailable');
    const scan = this.link.discoverUnprovisioned.bind(this.link);
    return this.serialize(scan);
  }

  private light(key: string): MeshLight {
    const light = this.config.lights.find((entry) => entry.key === key);
    if (!light) throw new Error(`Unknown fixture: ${key}`);
    return light;
  }
  private hold(keys: string[], minutes = 30, replace = false): void {
    const until = minutes === 0 ? 0 : Date.now() + minutes * 60_000;
    for (const key of keys) {
      const current = this.history?.getOverride?.(key) ?? this.manualOverrides.get(key) ?? 0;
      const expires = replace ? until : Math.max(until, current);
      this.manualOverrides.set(key, expires);
      this.history?.setOverride?.(key, expires);
    }
  }
  overrideStatus(keys: string[]): Record<string, number> {
    for (const key of keys) this.light(key);
    return Object.fromEntries(
      keys.map((key) => [
        key,
        Math.max(0, (this.history?.getOverride?.(key) ?? this.manualOverrides.get(key) ?? 0) - Date.now()),
      ])
    );
  }
  async override(keys: string[], minutes: number, signal?: AbortSignal): Promise<Record<string, number>> {
    if (!keys.length) throw new Error('Override requires targets');
    for (const key of keys) this.light(key);
    numberInRange(minutes, 'override minutes', 0, 1440);
    return this.serialize(async () => {
      this.hold(keys, minutes, true);
      return this.overrideStatus(keys);
    }, signal);
  }
  async reserveControl(keys: string[], minutes: number, signal?: AbortSignal): Promise<void> {
    if (!keys.length) throw new Error('Control reservation requires targets');
    for (const key of keys) this.light(key);
    numberInRange(minutes, 'control reservation minutes', 1, 1440);
    await this.serialize(async () => {
      this.hold(keys, minutes);
    }, signal);
  }
  async automaticCct(key: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const light = this.light(key);
    validateAction(light, 'cct', body);
    return this.serialize(async () => {
      if (this.overrideStatus([key])[key] > 0) return { skipped: true as const, reason: 'manual-override' };
      const state = await this.readWithReconnect(light.address, signal);
      if (state.sleep) return { skipped: true as const, reason: 'light-off' };
      const fan = await this.readFanWithReconnect(light.address, signal);
      if (fan.highTemperature) return { skipped: true as const, reason: 'thermal-protection' };
      if (fan.mode === FAN_MODES.off || (fan.mode === FAN_MODES.manual && fan.speed === 0))
        return { skipped: true as const, reason: 'stopped-cooling' };
      return { skipped: false as const, state: await this.apply(this.prepare(light, 'cct', body, state), signal) };
    }, signal);
  }
  async productInfo(key: string): Promise<ProductInfo> {
    const light = this.light(key);
    if (!this.link.readProductInfo) throw new Error('Product information readback is unavailable');
    const read = this.link.readProductInfo.bind(this.link);
    return this.serialize(() => this.telemetryWithReconnect(() => read(light.address)));
  }

  private serialize<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('BLE daemon is stopping'));
    if (this.queued >= 16) return Promise.reject(new Error('BLE command queue is full'));
    const expires = Date.now() + 45_000;
    this.queued++;
    const operation = this.queue.then(async () => {
      if (this.stopping || Date.now() > expires) throw new Error('BLE command expired before execution');
      signal?.throwIfAborted();
      return work();
    });
    this.queue = operation.then(
      () => {
        this.queued--;
      },
      () => {
        this.queued--;
      }
    );
    return operation;
  }

  async execute(
    key: string,
    action: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<CommandState> {
    const light = this.light(key);
    validateAction(light, action, body);
    return this.serialize(async () => {
      const previous = await this.readWithReconnect(light.address, signal);
      if (action === 'state') return previous;
      if (action === 'effect-stop' && previous.mode !== 'effect') return previous;
      const prepared = this.prepare(light, action, body, previous);
      this.hold([key]);
      if (action === 'effect-trigger') {
        signal?.throwIfAborted();
        await this.link.send(light.address, prepared.payload);
        try {
          const observed = await this.readWithReconnect(light.address, signal);
          if (!this.matches(observed, prepared.expected)) throw new Error('Effect settings readback mismatch');
          return { ...observed, triggerRequest: { sent: true, eventConfirmed: false } };
        } catch (error) {
          throw new Error(`Trigger may have been delivered; not retried: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
      const state = await this.apply(prepared, signal);
      const steady = this.steadyStates.get(key) ?? this.history?.getSteady(key);
      if (action === 'effect-stop' && steady?.sleep && !state.sleep) {
        return this.apply({ light, payload: powerPacket(false), expected: { sleep: true } }, signal);
      }
      return state;
    }, signal);
  }

  async batch(
    keys: string[],
    action: string,
    body: Record<string, unknown>,
    broadcast = false,
    signal?: AbortSignal,
    groupAddress?: number
  ): Promise<BatchResult> {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Batch requires unique, nonempty fixture targets');
    const lights = keys.map((key) => this.light(key));
    for (const light of lights) validateAction(light, action, body);
    if (action === 'state') throw new Error('Use a snapshot for grouped state reads');
    if (action === 'effect-stop') {
      if (broadcast) throw new Error('Effect restoration cannot use one broadcast payload');
      const states = await this.stopEffects(keys, signal);
      return { delivery: 'batched-unicast', states };
    }
    if (broadcast && lights.length !== this.config.lights.length)
      throw new Error('Broadcast addresses the whole mesh, not a subset group');
    return this.serialize(async () => {
      const prepared: Prepared[] = [];
      for (const light of lights)
        prepared.push(this.prepare(light, action, body, await this.readWithReconnect(light.address, signal)));
      if (broadcast && !prepared.every((item) => item.payload.equals(prepared[0].payload))) {
        throw new Error(
          'Broadcast needs identical applied settings; specify brightness and compatible parameters explicitly'
        );
      }
      signal?.throwIfAborted();
      this.hold(keys);
      const native = groupAddress !== undefined && prepared.every((item) => item.payload.equals(prepared[0].payload));
      if (
        groupAddress !== undefined &&
        (!Number.isInteger(groupAddress) || groupAddress < 0xc000 || groupAddress > 0xfeff)
      )
        throw new Error('Invalid native group address');
      try {
        if (broadcast) await this.link.send(0xffff, prepared[0].payload);
        else if (native) await this.link.send(groupAddress, prepared[0].payload);
        else
          for (const item of prepared) {
            signal?.throwIfAborted();
            await this.link.send(item.light.address, item.payload);
          }
      } catch (error) {
        throw new Error(`Batch delivery interrupted; some lights may have changed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      await delay(200);
      const states: Record<string, FixtureState> = {};
      const failures: string[] = [];
      for (const item of prepared) {
        try {
          const observed = await this.readWithReconnect(item.light.address, signal);
          if (action === 'effect-trigger' && !this.matches(observed, item.expected))
            throw new Error('Trigger settings mismatch; event not retried');
          states[item.light.key] = this.matches(observed, item.expected) ? observed : await this.apply(item, signal);
        } catch (error) {
          failures.push(`${item.light.name}: ${(error as Error).message}`);
        }
      }
      if (failures.length)
        throw new Error(`Partial batch failure (other lights may have changed): ${failures.join('; ')}`);
      return {
        delivery: broadcast ? 'mesh-broadcast' : native ? 'native-group' : 'batched-unicast',
        states,
        ...(action === 'effect-trigger'
          ? { triggerRequest: { sent: true as const, eventConfirmed: false as const } }
          : {}),
      };
    }, signal);
  }

  async snapshot(
    keys = this.config.lights.map((light) => light.key),
    includeFans = true
  ): Promise<Record<string, FixtureState>> {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Snapshot requires unique, nonempty targets');
    const lights = keys.map((key) => this.light(key));
    return this.serialize(async () => {
      const result: Record<string, FixtureState> = {};
      for (const light of lights) {
        const state = await this.readWithReconnect(light.address);
        if (!capabilities(light).gm_support) state.gm = undefined;
        if (includeFans) {
          const fan = await this.readFanWithReconnect(light.address);
          const mode = parseFanMode(fan.mode);
          if (mode === 'manual') throw new Error(`${light.name}: cannot infer a manual fan setpoint from current RPM`);
          state.fan = { mode };
        }
        result[light.key] = state;
      }
      return result;
    });
  }

  async stopEffects(keys: string[], signal?: AbortSignal): Promise<Record<string, FixtureState>> {
    if (!keys.length || new Set(keys).size !== keys.length) throw new Error('Effect stop requires unique targets');
    const lights = keys.map((key) => this.light(key));
    return this.serialize(async () => {
      const states: Record<string, FixtureState> = {};
      const restore: Record<string, FixtureState> = {};
      for (const light of lights) {
        const state = await this.readWithReconnect(light.address, signal);
        states[light.key] = state;
        if (state.mode !== 'effect') continue;
        const prior = this.steadyStates.get(light.key) ?? this.history?.getSteady(light.key);
        if (!prior) throw new Error(`${light.key}: no pre-effect state; explicitly select CCT or HSI`);
        restore[light.key] = prior;
      }
      return Object.keys(restore).length ? { ...states, ...(await this.restoreNow(restore, signal)) } : states;
    }, signal);
  }

  async restore(states: Record<string, FixtureState>, signal?: AbortSignal): Promise<Record<string, FixtureState>> {
    return this.serialize(() => this.restoreNow(states, signal), signal);
  }

  private async restoreNow(
    states: Record<string, FixtureState>,
    signal?: AbortSignal
  ): Promise<Record<string, FixtureState>> {
    const entries = Object.entries(states);
    if (!entries.length) throw new Error('Saved lighting state is empty');
    const actions = entries.map(([key, state]) => {
      const light = this.light(key);
      if (state.fan) {
        FanSettingSchema.parse(state.fan);
        validateFanRpm(state.fan.mode, state.fan.rpm);
        if (
          (state.fan.mode === 'off' || (state.fan.mode === 'manual' && state.fan.rpm === 0)) &&
          !state.sleep &&
          state.intensity > 0
        )
          throw new Error(`${light.name}: saved stopped cooling is incompatible with emitting LEDs`);
      }
      if (state.mode === 'effect' && state.speed !== undefined && state.speed !== 0)
        throw new Error(
          'These first-generation effects do not expose a separately verified speed parameter; use frequency'
        );
      if (!capabilities(light).gm_support && state.gm !== undefined && state.gm !== 0)
        throw new Error(`${light.name} cannot reproduce a preset with non-neutral G/M`);
      const action = state.mode === 'effect' ? 'effect' : state.mode;
      const body: Record<string, unknown> =
        state.mode === 'hsi'
          ? { hue: state.hue, saturation: state.sat, brightness: state.intensity / 10 }
          : state.mode === 'effect'
            ? {
                name: state.effect,
                brightness: state.intensity / 10,
                frequency: state.frequency,
                ...(state.cct === undefined ? {} : { kelvin: state.cct }),
                ...(state.palette === undefined ? {} : { palette: state.palette }),
                ...(state.hue === undefined ? {} : { hue: state.hue }),
                ...(state.sat === undefined ? {} : { saturation: state.sat }),
              }
            : { kelvin: state.cct, brightness: state.intensity / 10 };
      if (light.model === '150c' && state.mode !== 'hsi' && state.gm !== undefined) body.gm = state.gm;
      validateAction(light, action, body);
      return { light, action, body, state };
    });
    const result: Record<string, FixtureState> = {};
    for (const { light, state } of actions) {
      if (!state.fan) continue;
      const fan = await this.readFanWithReconnect(light.address, signal);
      if (fan.highTemperature) throw new FanThermalError(light);
      if (!fan.supported[state.fan.mode])
        throw new Error(`${light.name} does not advertise ${state.fan.mode} fan mode`);
    }
    this.hold(entries.map(([key]) => key));
    for (const { light, action, body, state } of actions) {
      const stoppedFan = state.fan?.mode === 'off' || (state.fan?.mode === 'manual' && state.fan.rpm === 0);
      if (state.fan && !stoppedFan) await this.applyFan(light, state.fan.mode, state.fan.rpm, signal);
      const before = await this.readWithReconnect(light.address, signal);
      const applied = await this.apply(
        this.prepare(light, action, state.sleep ? { ...body, brightness: 0 } : body, before),
        signal
      );
      result[light.key] =
        applied.sleep === state.sleep
          ? applied
          : await this.apply(
              {
                light,
                payload: powerPacket(!state.sleep),
                expected: { sleep: state.sleep },
              },
              signal
            );
      if (state.sleep && state.intensity !== 0)
        result[light.key] = await this.apply(
          {
            light,
            payload: brightnessPacket(state.intensity),
            expected: { sleep: true, intensity: state.intensity },
          },
          signal
        );
      if (state.fan && stoppedFan) await this.applyFan(light, state.fan.mode, state.fan.rpm, signal);
      if (state.fan) result[light.key].fan = state.fan;
    }
    return result;
  }

  async fade(keys: string[], brightness: unknown, seconds: unknown, signal?: AbortSignal): Promise<BatchResult> {
    const target = Math.round(numberInRange(brightness, 'brightness', 0, 100)) * 10;
    const duration = numberInRange(seconds, 'fade duration in seconds', 0.5, 20) * 1000;
    if (!keys.length || new Set(keys).size !== keys.length) throw new Error('Fade requires unique, nonempty targets');
    const lights = keys.map((key) => this.light(key));
    return this.serialize(async () => {
      const starts = [];
      for (const light of lights) {
        const state = await this.readWithReconnect(light.address, signal);
        if (state.mode === 'effect') throw new Error('Stop native effects before starting a brightness fade');
        starts.push({ light, state });
      }
      const steps = Math.ceil(duration / 500);
      this.hold(keys);
      const start = Date.now();
      const states: Record<string, FixtureState> = {};
      try {
        for (let step = 1; step <= steps; step++) {
          await delay(Math.max(0, start + (duration * step) / steps - Date.now()), undefined, { signal });
          for (const { light, state } of starts) {
            signal?.throwIfAborted();
            const intensity = Math.round((state.intensity + ((target - state.intensity) * step) / steps) / 10) * 10;
            await this.link.send(light.address, brightnessPacket(intensity));
          }
        }
        for (const { light, state } of starts) {
          const expected = { intensity: target, sleep: state.sleep };
          const observed = await this.readWithReconnect(light.address, signal);
          states[light.key] = this.matches(observed, expected)
            ? observed
            : await this.apply({ light, payload: brightnessPacket(target), expected }, signal);
        }
      } catch (error) {
        throw new Error(`Fade interrupted; lights may be at intermediate brightness: ${(error as Error).message}`, {
          cause: error,
        });
      }
      return { delivery: 'batched-unicast', states };
    }, signal);
  }

  async transition(
    keys: string[],
    action: string,
    body: Record<string, unknown>,
    seconds: number,
    signal?: AbortSignal
  ): Promise<BatchResult> {
    if (!['cct', 'hsi', 'brightness'].includes(action)) throw new Error('Transitions support cct, hsi or brightness');
    if (!keys.length || new Set(keys).size !== keys.length) throw new Error('Transition requires unique targets');
    const lights = keys.map((key) => this.light(key));
    for (const light of lights) validateAction(light, action, body);
    return this.serialize(async () => {
      const starts: Record<string, FixtureState> = {};
      const targets: Record<string, FixtureState> = {};
      for (const light of lights) {
        const state = await this.readWithReconnect(light.address, signal);
        starts[light.key] = state;
        targets[light.key] = { ...state, ...this.prepare(light, action, body, state).expected, sleep: state.sleep };
        if (!capabilities(light).gm_support) targets[light.key].gm = undefined;
      }
      return this.transitionNow(starts, targets, seconds, signal);
    }, signal);
  }

  async transitionScene(
    targets: Record<string, FixtureState>,
    seconds: number,
    signal?: AbortSignal
  ): Promise<BatchResult> {
    const lights = Object.keys(targets).map((key) => this.light(key));
    if (!lights.length) throw new Error('Scene transition requires targets');
    return this.serialize(async () => {
      const starts: Record<string, FixtureState> = {};
      for (const light of lights) starts[light.key] = await this.readWithReconnect(light.address, signal);
      return this.transitionNow(starts, targets, seconds, signal);
    }, signal);
  }

  private steadyBody(light: MeshLight, state: FixtureState): Record<string, unknown> {
    if (state.mode === 'effect') throw new Error('Stop native effects before a transition');
    return state.mode === 'hsi'
      ? { hue: state.hue, saturation: state.sat, brightness: state.intensity / 10 }
      : {
          kelvin: state.cct,
          brightness: state.intensity / 10,
          ...(capabilities(light).gm_support ? { gm: state.gm ?? 0 } : {}),
        };
  }

  private async transitionNow(
    starts: Record<string, FixtureState>,
    targets: Record<string, FixtureState>,
    seconds: number,
    signal?: AbortSignal
  ): Promise<BatchResult> {
    const duration = numberInRange(seconds, 'transition seconds', 0.5, 20) * 1000;
    const lights = Object.keys(targets).map((key) => this.light(key));
    for (const light of lights) {
      const from = starts[light.key],
        to = targets[light.key];
      validateAction(light, to.mode, this.steadyBody(light, to));
      this.steadyBody(light, from);
      if (from.mode !== to.mode && duration < 1000)
        throw new Error('Cross-mode transitions require at least one second');
      if (!capabilities(light).gm_support && to.gm !== undefined && to.gm !== 0)
        throw new Error('Target fixture does not support G/M');
      const fan = await this.readFanWithReconnect(light.address, signal);
      if (fan.highTemperature) throw new FanThermalError(light);
      if (to.fan) {
        FanSettingSchema.parse(to.fan);
        if (!fan.supported[to.fan.mode]) throw new Error(`${light.name} does not advertise ${to.fan.mode} fan mode`);
        if ((to.fan.mode === 'off' || (to.fan.mode === 'manual' && to.fan.rpm === 0)) && !to.sleep && to.intensity > 0)
          throw new Error('Stopped fan cannot accompany an emitting scene');
      }
      if (
        (fan.mode === FAN_MODES.off || (fan.mode === FAN_MODES.manual && fan.speed === 0)) &&
        ((!from.sleep && from.intensity > 0) || (!to.sleep && to.intensity > 0)) &&
        (!to.fan || to.fan.mode === 'off' || (to.fan.mode === 'manual' && to.fan.rpm === 0))
      )
        throw new Error(`${light.name}: select a cooling profile before increasing output`);
    }
    signal?.throwIfAborted();
    this.hold(lights.map((light) => light.key));
    for (const light of lights) {
      const fan = targets[light.key].fan;
      if (fan && fan.mode !== 'off' && !(fan.mode === 'manual' && fan.rpm === 0))
        await this.applyFan(light, fan.mode, fan.rpm, signal);
    }
    const steps = Math.ceil(duration / 500),
      start = Date.now();
    try {
      for (let step = 1; step <= steps; step++) {
        await delay(Math.max(0, start + (duration * step) / steps - Date.now()), undefined, { signal });
        for (const light of lights) {
          signal?.throwIfAborted();
          const frame = interpolateState(starts[light.key], targets[light.key], step / steps);
          const payload = this.prepare(light, frame.mode, this.steadyBody(light, frame), starts[light.key]).payload;
          await this.link.send(light.address, payload);
        }
      }
      return { delivery: 'batched-unicast', states: await this.restoreNow(targets, signal) };
    } catch (error) {
      throw new Error(`Transition interrupted; fixtures may be at intermediate settings: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  async fan(key: string, mode?: unknown, signal?: AbortSignal, rpm?: unknown): Promise<FanState> {
    const states = await this.fans([key], mode, signal, rpm);
    return states[key];
  }

  async fans(keys: string[], mode?: unknown, signal?: AbortSignal, rpm?: unknown): Promise<Record<string, FanState>> {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Fan control requires unique, nonempty targets');
    const lights = keys.map((key) => this.light(key));
    const desired = mode === undefined ? undefined : parseFanMode(mode);
    if (desired === undefined && rpm !== undefined) throw new Error('RPM requires manual fan mode');
    const speed = desired === undefined ? undefined : validateFanRpm(desired, rpm);
    return this.serialize(async () => {
      const states: Record<string, FanState> = {};
      for (const light of lights) {
        states[light.key] = await this.readFanWithReconnect(light.address, signal);
        if (desired !== undefined) await this.validateFan(light, desired, states[light.key], speed, signal);
      }
      if (desired === undefined) return states;
      const applied: string[] = [];
      for (const light of lights) {
        try {
          signal?.throwIfAborted();
          states[light.key] = await this.applyFan(light, desired, speed, signal);
          applied.push(light.key);
        } catch (error) {
          if (lights.length === 1) throw error;
          throw new Error(
            `Fan batch stopped at ${light.key}; verified targets: ${applied.join(', ') || 'none'}. Some profiles may have changed. ${(error as Error).message}`,
            { cause: error }
          );
        }
      }
      return states;
    }, signal);
  }

  private async validateFan(
    light: MeshLight,
    desired: FanMode,
    state: FanState,
    rpm?: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (state.highTemperature) throw new FanThermalError(light);
    if (!state.supported[desired]) throw new Error(`${light.name} does not advertise ${desired} fan mode`);
    if (desired === 'off' || (desired === 'manual' && rpm === 0)) {
      const lighting = await this.readWithReconnect(light.address, signal);
      if (!lighting.sleep && lighting.intensity > 0)
        throw new Error(
          `${light.name}: switch the LEDs off or set brightness to zero before requesting stopped cooling`
        );
    }
  }

  private fanMatches(state: FanState, desired: FanMode, rpm?: number): boolean {
    return state.mode === FAN_MODES[desired] && (desired !== 'manual' || state.speed === rpm);
  }

  private async applyFan(light: MeshLight, desired: FanMode, rpm?: number, signal?: AbortSignal): Promise<FanState> {
    const before = await this.readFanWithReconnect(light.address, signal);
    await this.validateFan(light, desired, before, rpm, signal);
    if (desired !== 'manual' && this.fanMatches(before, desired)) return before;
    signal?.throwIfAborted();
    try {
      await this.link.send(light.address, fanPacket(desired, rpm));
      for (let attempt = 0; attempt < 5; attempt++) {
        await delay(300, undefined, { signal });
        const state = await this.readFanWithReconnect(light.address, signal);
        if (state.highTemperature) throw new FanThermalError(light);
        if (this.fanMatches(state, desired, rpm)) return state;
      }
      throw new Error(`${light.name} fan ${desired === 'manual' ? 'mode/RPM' : 'mode'} did not verify`);
    } catch (error) {
      if (error instanceof FanThermalError) throw error;
      let recovery: FanState;
      try {
        recovery = await this.readFanWithReconnect(light.address);
        if (recovery.highTemperature) throw new FanThermalError(light);
        if (this.fanMatches(recovery, desired, rpm) && !signal?.aborted) return recovery;
        if (!recovery.supported.smart) throw new Error('Smart recovery is not advertised');
        if (recovery.mode !== FAN_MODES.smart) {
          await this.link.send(light.address, fanPacket('smart'));
          await delay(300);
          recovery = await this.readFanWithReconnect(light.address);
          if (recovery.highTemperature) throw new FanThermalError(light);
          if (recovery.mode !== FAN_MODES.smart) throw new Error('Smart cooling readback mismatch');
        }
      } catch (failure) {
        if (failure instanceof FanThermalError) throw failure;
        throw new AggregateError(
          [error, failure],
          `${light.name}: fan change and recovery could not be verified; inspect the fixture`
        );
      }
      throw new Error(`${(error as Error).message}; Smart automatic cooling is confirmed`, { cause: error });
    }
  }

  private prepare(light: MeshLight, action: string, body: Record<string, unknown>, previous: FixtureState): Prepared {
    if (previous.mode !== 'effect') {
      this.steadyStates.set(light.key, previous);
      this.history?.saveSteady(light.key, previous);
    }
    const caps = capabilities(light);
    if (action === 'effect-stop') {
      const steady = this.steadyStates.get(light.key) ?? this.history?.getSteady(light.key);
      if (!steady)
        throw new Error('Previous steady state is unavailable; explicitly select CCT or HSI to stop the effect');
      return this.prepare(
        light,
        steady.mode,
        steady.mode === 'hsi'
          ? { hue: steady.hue, saturation: steady.sat, brightness: steady.intensity / 10 }
          : {
              kelvin: steady.cct,
              brightness: steady.intensity / 10,
              ...(caps.gm_support ? { gm: steady.gm ?? 0 } : {}),
            },
        previous
      );
    }
    if (action === 'increment-brightness')
      return this.prepare(
        light,
        'brightness',
        {
          value: Math.max(0, Math.min(100, previous.intensity / 10 + numberInRange(body.delta, 'delta', -100, 100))),
        },
        previous
      );
    if (action === 'increment-cct') {
      if (previous.mode !== 'cct' || previous.cct === undefined)
        throw new Error('Relative CCT requires an active CCT setting');
      return this.prepare(
        light,
        'cct',
        {
          kelvin: Math.max(
            caps.cct_min,
            Math.min(caps.cct_max, previous.cct + numberInRange(body.delta, 'delta', -7500, 7500))
          ),
          ...(body.brightness === undefined ? {} : { brightness: body.brightness }),
        },
        previous
      );
    }
    if (action === 'gm') {
      if (previous.mode !== 'cct')
        throw new Error('G/M adjustment is supported in CCT mode; advanced HSI tint is not supported by the 150c');
      return this.prepare(light, 'cct', { kelvin: previous.cct, gm: body.value }, previous);
    }
    if (action === 'color')
      return this.prepare(
        light,
        'hsi',
        { ...colorToHSI(body.color), ...(body.brightness === undefined ? {} : { brightness: body.brightness }) },
        previous
      );
    if (['effect-speed', 'effect-intensity', 'effect-trigger'].includes(action)) {
      if (previous.mode !== 'effect' || !previous.effect) throw new Error('No native effect is active');
      if (action === 'effect-trigger' && (previous.sleep || !TRIGGER_EFFECTS.includes(previous.effect)))
        throw new Error('Trigger requires an awake lightning, faulty-bulb, pulsing, strobe or explosion effect');
      return this.prepare(
        light,
        'effect',
        {
          name: previous.effect,
          frequency: action === 'effect-speed' ? body.value : previous.frequency,
          brightness: action === 'effect-intensity' ? body.value : previous.intensity / 10,
          ...(previous.cct === undefined ? {} : { kelvin: previous.cct }),
          ...(previous.palette === undefined ? {} : { palette: previous.palette }),
          ...(previous.hue === undefined ? {} : { hue: previous.hue }),
          ...(previous.sat === undefined ? {} : { saturation: previous.sat }),
          ...(action === 'effect-trigger' ? { _trigger: true } : {}),
        },
        previous
      );
    }
    const expected: Partial<FixtureState> = {};
    let payload: Buffer;
    if (action === 'on' || action === 'off' || action === 'toggle') {
      expected.sleep = action === 'toggle' ? !previous.sleep : action === 'off';
      payload = powerPacket(!expected.sleep);
    } else if (action === 'brightness') {
      expected.intensity = Math.round(numberInRange(body.value, 'brightness', 0, 100)) * 10;
      payload = brightnessPacket(expected.intensity);
    } else {
      expected.sleep = false;
      expected.intensity =
        body.brightness === undefined
          ? previous.intensity
          : Math.round(numberInRange(body.brightness, 'brightness', 0, 100)) * 10;
      if (action === 'cct') {
        expected.mode = 'cct';
        expected.cct = Math.round(numberInRange(body.kelvin, 'CCT', caps.cct_min, caps.cct_max) / 100) * 100;
        const gm = caps.gm_support
          ? Math.round(numberInRange(body.gm ?? previous.gm ?? 0, 'G/M', -100, 100) / 10) * 10
          : 0;
        if (caps.gm_support) expected.gm = gm;
        payload = cctPacket(expected.cct, expected.intensity, gm);
      } else if (action === 'hsi') {
        expected.mode = 'hsi';
        expected.hue = Math.round(numberInRange(body.hue, 'hue', 0, 360)) % 360;
        expected.sat = Math.round(numberInRange(body.saturation, 'saturation', 0, 100));
        payload = hsiPacket(expected.hue, expected.sat, expected.intensity);
      } else if (action === 'effect') {
        const effect = effectName(body.name);
        const options: EffectOptions = {
          effect,
          intensity: expected.intensity,
          frequency: Math.round(numberInRange(body.frequency ?? previous.frequency ?? 1, 'frequency', 1, 10)),
          speed: 0,
          ...(body._trigger === true ? { trigger: 1 as const } : {}),
          cct:
            Math.round(numberInRange(body.kelvin ?? previous.cct ?? 3200, 'CCT', caps.cct_min, caps.cct_max) / 100) *
            100,
          gm: caps.gm_support ? Math.round(numberInRange(body.gm ?? previous.gm ?? 0, 'G/M', -100, 100) / 10) * 10 : 0,
          palette: Math.round(numberInRange(body.palette ?? previous.palette ?? 0, 'palette', 0, 2)),
          ...(body.hue === undefined ? {} : { hue: Math.round(numberInRange(body.hue, 'hue', 0, 360)) % 360 }),
          ...(body.saturation === undefined
            ? {}
            : { saturation: Math.round(numberInRange(body.saturation, 'saturation', 0, 100)) }),
        };
        payload = effectPacket(options);
        Object.assign(expected, { mode: 'effect', effect, frequency: options.frequency });
        if (options.hue !== undefined) {
          expected.hue = options.hue;
          expected.sat = options.saturation;
        } else if (['paparazzi', 'lightning', 'faulty-bulb', 'pulsing', 'strobe', 'explosion'].includes(effect)) {
          expected.cct = options.cct;
          if (caps.gm_support) expected.gm = options.gm;
        }
        if (['lightning', 'faulty-bulb', 'pulsing'].includes(effect)) expected.speed = options.speed;
        if (['tv', 'fire', 'fireworks', 'cop-car'].includes(effect)) expected.palette = options.palette;
        if (effect === 'party-lights') expected.sat = options.saturation ?? 100;
      } else throw new Error(`Unsupported action: ${action}`);
    }
    return { light, payload, expected };
  }

  private matches(state: FixtureState, expected: Partial<FixtureState>): boolean {
    return Object.entries(expected).every(([field, value]) => state[field as keyof FixtureState] === value);
  }

  private async apply(item: Prepared, signal?: AbortSignal): Promise<FixtureState> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      try {
        if (!this.link.ready) await this.link.connect();
        signal?.throwIfAborted();
        await this.link.send(item.light.address, item.payload);
        await delay(200);
        const state = await this.link.readState(item.light.address);
        if (this.matches(state, item.expected)) return state;
        throw new Error(
          `Fixture readback mismatch: wanted ${JSON.stringify(item.expected)}, observed ${JSON.stringify(state)}`
        );
      } catch (error) {
        lastError = error;
        console.error(`${item.light.name} attempt ${attempt + 1}/3 failed: ${(error as Error).message}`);
        if (attempt < 2) {
          await this.link.disconnect();
          await delay(300);
        }
      }
    }
    throw new Error(`Unable to verify ${item.light.name}: ${(lastError as Error).message}`);
  }

  private async readWithReconnect(address: number, signal?: AbortSignal): Promise<FixtureState> {
    return this.telemetryWithReconnect(() => this.link.readState(address), signal);
  }

  private async readFanWithReconnect(address: number, signal?: AbortSignal): Promise<FanState> {
    if (!this.link.readFan) throw new Error('Fan readback is unavailable');
    const readFan = this.link.readFan.bind(this.link);
    return this.telemetryWithReconnect(async () => describeFan(FanStateSchema.parse(await readFan(address))), signal);
  }

  private async telemetryWithReconnect<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        if (!this.link.ready) await this.link.connect();
        signal?.throwIfAborted();
        return await read();
      } catch (error) {
        if (attempt === 1 || signal?.aborted) throw error;
        console.error(`BLE telemetry read failed; reconnecting: ${(error as Error).message}`);
        await this.link.disconnect();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.queue;
    await this.link.disconnect();
  }
}
