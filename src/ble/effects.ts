import { numberInRange, packet } from './packets.js';
import type { FixtureState } from './telink.js';

export const EFFECTS = {
  paparazzi: 1,
  lightning: 2,
  tv: 3,
  fire: 5,
  strobe: 6,
  explosion: 7,
  'faulty-bulb': 8,
  pulsing: 9,
  'cop-car': 11,
  'party-lights': 13,
  fireworks: 14,
} as const;
export type EffectName = keyof typeof EFFECTS;
export const TRIGGER_EFFECTS: EffectName[] = ['lightning', 'faulty-bulb', 'pulsing', 'strobe', 'explosion'];
export const WHITE_EFFECTS: EffectName[] = [
  'paparazzi',
  'fireworks',
  'tv',
  'fire',
  'lightning',
  'faulty-bulb',
  'pulsing',
  'strobe',
  'explosion',
];
export const COLOR_EFFECTS: EffectName[] = [
  'paparazzi',
  'fireworks',
  'tv',
  'fire',
  'lightning',
  'faulty-bulb',
  'pulsing',
  'cop-car',
  'party-lights',
];

export function effectName(value: unknown): EffectName {
  if (typeof value !== 'string') throw new Error('Effect name is required');
  const name = value.toLowerCase().replaceAll('_', '-');
  if (!Object.hasOwn(EFFECTS, name)) throw new Error(`Unknown effect: ${value}`);
  return name as EffectName;
}

export interface EffectOptions {
  effect: EffectName;
  intensity: number;
  frequency: number;
  speed: number;
  cct: number;
  gm: number;
  palette: number;
  hue?: number;
  saturation?: number;
  trigger?: 0 | 1 | 2;
}

export function effectPacket(options: EffectOptions): Buffer {
  const { effect } = options;
  if (options.trigger !== undefined) {
    numberInRange(options.trigger, 'trigger', 0, 2);
    if (!Number.isInteger(options.trigger)) throw new Error('Trigger mode must be an integer');
  }
  const id = EFFECTS[effect];
  const intensity = BigInt(Math.round(numberInRange(options.intensity, 'intensity', 0, 1000)));
  const frequency = BigInt(Math.round(numberInRange(options.frequency, 'frequency', 1, 10)));
  const cct = BigInt(Math.round(numberInRange(options.cct, 'CCT', 2500, 7500) / 10));
  const gm = BigInt(Math.round(numberInRange(options.gm, 'G/M', -100, 100) / 10) + 10);
  const speed = BigInt(Math.round(numberInRange(options.speed, 'speed', 0, 10)));
  const palette = BigInt(Math.round(numberInRange(options.palette, 'palette', 0, 2)));
  let bits = BigInt(id) << 64n;
  if ([6, 7, 8, 9].includes(id)) {
    bits |= (intensity << 46n) | (frequency << 56n);
    if (options.hue !== undefined) {
      const hue = BigInt(Math.round(numberInRange(options.hue, 'hue', 0, 360)) % 360);
      const sat = BigInt(Math.round(numberInRange(options.saturation, 'saturation', 0, 100)));
      bits |= (1n << 60n) | (hue << 37n) | (sat << 30n) | (BigInt(options.trigger ?? 1) << 28n);
      if (id === 8 || id === 9) bits |= speed << 24n;
    } else {
      bits |= (cct << 36n) | (gm << 29n) | (BigInt(options.trigger ?? 1) << 27n);
      if (id === 8 || id === 9) bits |= speed << 23n;
    }
  } else {
    bits |= (intensity << 54n) | (frequency << 50n);
    if (id === 1 || id === 2) bits |= (cct << 40n) | (gm << 33n);
    if (id === 2) bits |= (speed << 27n) | (BigInt(options.trigger ?? 0) << 31n);
    if (id === 3 || id === 5) bits |= palette << 40n;
    if (id === 14) bits |= palette << 42n;
    if (id === 11) bits |= palette << 46n;
    if (id === 13) bits |= BigInt(Math.round(numberInRange(options.saturation ?? 100, 'saturation', 0, 100))) << 43n;
  }
  return packet(0x87, bits);
}

export function decodeEffect(data: Buffer): FixtureState {
  const id = data[8];
  const effect = Object.entries(EFFECTS).find(([, value]) => value === id)?.[0] as EffectName | undefined;
  if (!effect) throw new Error(`Unsupported native effect reply ${id}`);
  const bits = data.readBigUInt64LE();
  const field = (offset: bigint, mask: bigint) => Number((bits >> offset) & mask);
  const compact = [6, 7, 8, 9].includes(id);
  const variant = compact ? field(60n, 15n) : 0;
  if (variant > 1) throw new Error('Unsupported GEL effect variant on these fixtures');
  const state: FixtureState = {
    sleep: !(data[1] & 1),
    mode: 'effect',
    effect,
    intensity: field(compact ? 46n : 54n, 1023n),
    frequency: field(compact ? 56n : 50n, 15n),
    observedAt: new Date().toISOString(),
  };
  if (compact && variant === 1) {
    state.hue = field(37n, 511n);
    state.sat = field(30n, 127n);
  } else if (compact || id === 1 || id === 2) {
    state.cct = field(compact ? 36n : 40n, 1023n) * 10;
    state.gm = (field(compact ? 29n : 33n, 127n) - 10) * 10;
  }
  if (id === 8 || id === 9 || id === 2) state.speed = field(id === 2 ? 27n : variant === 1 ? 24n : 23n, 15n);
  if (id === 3 || id === 5) state.palette = field(40n, 1023n);
  if (id === 14) state.palette = field(42n, 255n);
  if (id === 11) state.palette = field(46n, 15n);
  if (id === 13) state.sat = field(43n, 127n);
  return state;
}
