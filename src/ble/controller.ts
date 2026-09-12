import { setTimeout as delay } from 'node:timers/promises';
import { colorToHSI } from './colors.js';
import { COLOR_EFFECTS, type EffectOptions, effectName, effectPacket, WHITE_EFFECTS } from './effects.js';
import { describeFan, FanStateSchema } from './fan.js';
import type { SteadyHistory } from './library.js';
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

export interface MeshLink {
  readonly ready: boolean;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(address: number, payload: Buffer): Promise<void>;
  readState(address: number): Promise<FixtureState>;
  readFan?(address: number): Promise<FanState>;
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
  delivery: 'mesh-broadcast' | 'batched-unicast';
  states: Record<string, FixtureState>;
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

  constructor(
    readonly config: MeshConfig,
    readonly link: MeshLink,
    private readonly history?: SteadyHistory
  ) {}

  private light(key: string): MeshLight {
    const light = this.config.lights.find((entry) => entry.key === key);
    if (!light) throw new Error(`Unknown fixture: ${key}`);
    return light;
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
  ): Promise<FixtureState> {
    const light = this.light(key);
    validateAction(light, action, body);
    return this.serialize(async () => {
      const previous = await this.readWithReconnect(light.address, signal);
      if (action === 'state') return previous;
      if (action === 'effect-stop' && previous.mode !== 'effect') return previous;
      const prepared = this.prepare(light, action, body, previous);
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
    signal?: AbortSignal
  ): Promise<BatchResult> {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Batch requires unique, nonempty fixture targets');
    const lights = keys.map((key) => this.light(key));
    for (const light of lights) validateAction(light, action, body);
    if (['state', 'effect-stop'].includes(action)) throw new Error(`${action} is not a shared batch action`);
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
      try {
        if (broadcast) await this.link.send(0xffff, prepared[0].payload);
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
          states[item.light.key] = this.matches(observed, item.expected) ? observed : await this.apply(item, signal);
        } catch (error) {
          failures.push(`${item.light.name}: ${(error as Error).message}`);
        }
      }
      if (failures.length)
        throw new Error(`Partial batch failure (other lights may have changed): ${failures.join('; ')}`);
      return { delivery: broadcast ? 'mesh-broadcast' : 'batched-unicast', states };
    }, signal);
  }

  async snapshot(keys = this.config.lights.map((light) => light.key)): Promise<Record<string, FixtureState>> {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Snapshot requires unique, nonempty targets');
    const lights = keys.map((key) => this.light(key));
    return this.serialize(async () => {
      const result: Record<string, FixtureState> = {};
      for (const light of lights) {
        const state = await this.readWithReconnect(light.address);
        if (!capabilities(light).gm_support) state.gm = undefined;
        result[light.key] = state;
      }
      return result;
    });
  }

  async restore(states: Record<string, FixtureState>, signal?: AbortSignal): Promise<Record<string, FixtureState>> {
    const entries = Object.entries(states);
    if (!entries.length) throw new Error('Saved lighting state is empty');
    const actions = entries.map(([key, state]) => {
      const light = this.light(key);
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
    return this.serialize(async () => {
      const result: Record<string, FixtureState> = {};
      for (const { light, action, body, state } of actions) {
        const before = await this.readWithReconnect(light.address, signal);
        const applied = await this.apply(this.prepare(light, action, body, before), signal);
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
      }
      return result;
    }, signal);
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
    if (['effect-speed', 'effect-intensity'].includes(action)) {
      if (previous.mode !== 'effect' || !previous.effect) throw new Error('No native effect is active');
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
