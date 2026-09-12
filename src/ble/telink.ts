import { decodeEffect, type EffectName } from './effects.js';
import { numberInRange, packet } from './packets.js';

export { numberInRange } from './packets.js';

export interface FixtureState {
  sleep: boolean;
  intensity: number;
  mode: 'cct' | 'hsi' | 'effect';
  cct?: number;
  gm?: number;
  hue?: number;
  sat?: number;
  effect?: EffectName;
  frequency?: number;
  speed?: number;
  palette?: number;
  observedAt: string;
  fan?: { mode: FanMode; rpm?: number };
}

function intensityBits(intensity: number): bigint {
  return BigInt(Math.round(numberInRange(intensity, 'intensity', 0, 1000))) << 62n;
}

export const readStatePacket = (): Buffer => packet(0x0e);
export const readFanPacket = (): Buffer => packet(0x09);
export const powerPacket = (on: boolean): Buffer => packet(0x8c, on ? 1n << 64n : 0n);
export const brightnessPacket = (intensity: number): Buffer => packet(0x8f, intensityBits(intensity));

export function cctPacket(kelvin: number, intensity: number, gm = 0): Buffer {
  // These fixtures use 10-K units, not raw kelvin or the SDK's extended-CCT flag.
  const cct = Math.round(numberInRange(kelvin, 'CCT', 2500, 7500) / 10);
  const tint = Math.round(numberInRange(gm, 'G/M', -100, 100) / 10) + 10;
  return packet(0x82, intensityBits(intensity) | (BigInt(cct) << 52n) | (BigInt(tint) << 45n));
}

export function hsiPacket(hue: number, saturation: number, intensity: number): Buffer {
  const h = Math.round(numberInRange(hue, 'hue', 0, 360)) % 360;
  const s = Math.round(numberInRange(saturation, 'saturation', 0, 100));
  return packet(0x81, intensityBits(intensity) | (BigInt(h) << 53n) | (BigInt(s) << 46n));
}

export function decodeState(data: Buffer): FixtureState | undefined {
  if (data.length !== 10) return undefined;
  if ((data.subarray(1).reduce((sum, value) => sum + value, 0) & 255) !== data[0]) {
    throw new Error('Invalid fixture state checksum');
  }
  const mode = data[9] & 127;
  if (mode === 7) return decodeEffect(data);
  if (mode !== 1 && mode !== 2) return undefined;
  const bits = data.readBigUInt64LE() | (BigInt(data[8]) << 64n);
  const field = (offset: bigint, mask: bigint) => Number((bits >> offset) & mask);
  const state: FixtureState = {
    sleep: !(data[1] & 1),
    intensity: field(62n, 1023n),
    mode: mode === 2 ? 'cct' : 'hsi',
    observedAt: new Date().toISOString(),
  };
  if (mode === 2) {
    if (field(42n, 1n)) throw new Error('Unsupported extended-CCT state encoding');
    state.cct = field(52n, 1023n) * 10;
    state.gm = (field(45n, 127n) - 10) * 10;
  } else {
    state.hue = field(53n, 511n);
    state.sat = field(46n, 127n);
  }
  return state;
}

export interface FanState {
  mode: number;
  speed: number;
  temperature: number;
  highTemperature: boolean;
  allowedModes?: FanMode[];
  modeName?: string;
  rpmStatus?: 'zero-reported' | 'rotation-reported';
  supported: {
    silent: boolean;
    low: boolean;
    medium: boolean;
    high: boolean;
    off: boolean;
    max: boolean;
    smart: boolean;
    manual: boolean;
  };
}

export const FAN_MODES = { manual: 0, smart: 1, max: 2, off: 3, high: 4, medium: 5, low: 6, silent: 7 } as const;
export type FanMode = keyof typeof FAN_MODES;

export function parseFanMode(value: unknown): FanMode {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    value = /^\d+$/.test(normalized) ? Number(normalized) : normalized;
  }
  if (typeof value === 'string' && Object.hasOwn(FAN_MODES, value)) return value as FanMode;
  const match = Object.entries(FAN_MODES).find(([, mode]) => mode === value);
  if (match) return match[0] as FanMode;
  throw new Error('Unknown fan mode. Use manual=0, smart=1, max=2, off=3, high=4, medium=5, low=6 or silent=7.');
}

export function validateFanRpm(mode: FanMode, rpm: unknown): number | undefined {
  if (mode !== 'manual') {
    if (rpm !== undefined) throw new Error('RPM is only valid with manual fan mode');
    return undefined;
  }
  if (rpm === undefined) throw new Error('Manual fan mode requires an explicit RPM setting (--rpm)');
  const value = numberInRange(rpm, 'Manual fan RPM', 0, 65535);
  if (!Number.isInteger(value)) throw new Error('Manual fan RPM must be an integer');
  return value;
}

export function fanPacket(mode: FanMode, rpm?: number): Buffer {
  const selected = parseFanMode(mode);
  const speed = validateFanRpm(selected, rpm);
  return packet(0x89, (BigInt(FAN_MODES[selected]) << 64n) | (BigInt(speed ?? 0) << 48n));
}

export function decodeFan(data: Buffer): FanState | undefined {
  if (data.length !== 10 || (data[9] & 127) !== 9) return undefined;
  if ((data.subarray(1).reduce((sum, value) => sum + value, 0) & 255) !== data[0])
    throw new Error('Invalid fan status checksum');
  const bits = data.readBigUInt64LE();
  const flag = (bit: number) => Boolean((bits >> BigInt(bit)) & 1n);
  return {
    mode: data[8],
    speed: data.readUInt16LE(6),
    temperature: data[5],
    highTemperature: Boolean((bits >> 36n) & 15n),
    supported: {
      silent: flag(28),
      low: flag(29),
      medium: flag(30),
      high: flag(31),
      off: flag(32),
      max: flag(33),
      smart: flag(34),
      manual: flag(35),
    },
  };
}
