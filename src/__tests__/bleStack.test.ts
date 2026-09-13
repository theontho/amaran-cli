import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capabilities, type MeshLink, VerifiedController, validateAction } from '../ble/controller.js';
import { cmac, MeshCrypto } from '../ble/crypto.js';
import { EFFECTS, effectPacket } from '../ble/effects.js';
import { LocalLibrary } from '../ble/library.js';
import { packet } from '../ble/packets.js';
import { createBleServer } from '../ble/server.js';
import { decodeProductInfo } from '../ble/settings.js';
import { atomicJson, type MeshConfig, MeshConfigSchema, SequenceStore } from '../ble/storage.js';
import {
  brightnessPacket,
  cctPacket,
  decodeFan,
  decodeState,
  FAN_MODES,
  type FanState,
  type FixtureState,
  fanPacket,
  hsiPacket,
  parseFanMode,
  powerPacket,
  readStatePacket,
} from '../ble/telink.js';
import { interpolateState } from '../ble/transitions.js';
import { ProxyAssembler, proxyFragments } from '../ble/transport.js';
import { commandCallbackResult, getAppliedNumber, getLightDevices } from '../commands/cmdUtils.js';
import registerCct from '../commands/deviceControl/cct.js';
import registerFan from '../commands/deviceControl/fan.js';
import type { CircadianDashboardStatus } from '../daylightSimulation/dashboardStatus.js';
import BleHttpController from '../deviceControl/bleHttpControl.js';

// Public Bluetooth Mesh specification test keys; never real fixture credentials.
const config: MeshConfig = {
  netKey: '7dd7364cd842ad18c17c2b820c84c3d6',
  appKey: '63964771734fbd76e3b40519d1d94a48',
  source: 32766,
  lights: [
    { key: 'desk', name: '200x desk', address: 6, mac: '', model: '200x-s' },
    { key: 'back', name: '150c back', address: 10, mac: '', model: '150c' },
  ],
};
const initial: FixtureState = {
  sleep: true,
  intensity: 10,
  mode: 'cct',
  cct: 3200,
  gm: 0,
  observedAt: new Date().toISOString(),
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeLink() {
  const states = new Map(config.lights.map((light) => [light.address, { ...initial }]));
  const fans = new Map<number, FanState>(
    config.lights.map((light) => [
      light.address,
      {
        mode: 1,
        speed: 1000,
        temperature: 35,
        highTemperature: false,
        supported: {
          smart: true,
          medium: true,
          high: false,
          max: false,
          silent: false,
          low: false,
          off: false,
          manual: false,
        },
      },
    ])
  );
  const link = {
    ready: true,
    states,
    fans,
    get state() {
      const state = states.get(6);
      if (!state) throw new Error('Missing fixture');
      return state;
    },
    connect: vi.fn(async () => {
      link.ready = true;
    }),
    disconnect: vi.fn(async () => {
      link.ready = false;
    }),
    readState: vi.fn(async (address: number) => {
      const state = states.get(address);
      if (!state) throw new Error('Missing fixture');
      return { ...state, observedAt: new Date().toISOString() };
    }),
    readFan: vi.fn(async (address: number) => {
      const fan = fans.get(address);
      if (!fan) throw new Error('Missing fan');
      return structuredClone(fan);
    }),
    send: vi.fn(async (address: number, payload: Buffer) => {
      const targets = address === 0xffff ? config.lights.map((light) => light.address) : [address];
      for (const target of targets) {
        const state = states.get(target);
        if (!state) throw new Error('Unknown fake fixture');
        const bits = payload.readBigUInt64LE() | (BigInt(payload[8]) << 64n);
        const intensity = Number((bits >> 62n) & 1023n);
        switch (payload[9]) {
          case 0x8c:
            state.sleep = !payload[8];
            break;
          case 0x8f:
            state.intensity = intensity;
            break;
          case 0x82:
          case 0x81:
          case 0x87: {
            const reply = Buffer.from(payload);
            reply[9] &= 127;
            reply[1] |= 1;
            reply[0] = reply.subarray(1).reduce((sum, byte) => sum + byte, 0) & 255;
            const decoded = decodeState(reply);
            if (!decoded) throw new Error('No fake decoded state');
            states.set(target, decoded);
            break;
          }
          case 0x89: {
            const fan = fans.get(target);
            if (!fan) throw new Error('No fake fan');
            fan.mode = payload[8];
            fan.speed = fan.mode === FAN_MODES.manual ? payload.readUInt16LE(6) : fan.mode === FAN_MODES.off ? 0 : 1500;
            break;
          }
        }
      }
    }),
  };
  return link satisfies MeshLink;
}

describe('mesh cryptography and proxy framing', () => {
  const crypto = new MeshCrypto(config.netKey, config.appKey);
  it('matches NIST CMAC and Bluetooth key derivation vectors', () => {
    const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
    expect(cmac(key, Buffer.alloc(0)).toString('hex')).toBe('bb1d6929e95937287fa37d129b756746');
    expect(cmac(key, Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex')).toString('hex')).toBe(
      '070a16b46b4d4144f79bdd9dd04a287c'
    );
    expect(crypto.nid).toBe(0x68);
    expect(crypto.networkId.toString('hex')).toBe('3ecaff672f673370');
    expect(crypto.aid).toBe(0x26);
  });
  it.each([false, true])('authenticates network PDUs (proxy=%s)', (proxy) => {
    const message = {
      source: 32766,
      destination: proxy ? 0 : 6,
      sequence: 128,
      iv: 0,
      control: proxy,
      transport: Buffer.from([0, 0]),
    };
    const encoded = crypto.network(message, proxy);
    expect(crypto.readNetwork(encoded, 0, proxy)).toEqual(message);
    encoded[encoded.length - 1] ^= 1;
    expect(() => crypto.readNetwork(encoded, 0, proxy)).toThrow();
  });
  it('authenticates application data and the correct destination', () => {
    const message = { source: 6, destination: 1, sequence: 555, iv: 0, control: false, transport: Buffer.alloc(0) };
    const access = Buffer.concat([Buffer.from([0x26]), readStatePacket()]);
    const lower = crypto.access(access, 555, 6, 1, 0);
    expect(crypto.readAccess(lower.subarray(1), message)).toEqual(access);
    expect(() => crypto.readAccess(lower.subarray(1), { ...message, destination: 32766 })).toThrow();
  });
  it('only selects advertisements from the configured network', () => {
    expect(crypto.matchesAdvertisement(Buffer.concat([Buffer.from([0]), crypto.networkId]), [6])).toBe(true);
    expect(crypto.matchesAdvertisement(Buffer.alloc(9), [6])).toBe(false);
    expect(() => crypto.readBeacon(Buffer.alloc(22))).toThrow();
  });
  it('reassembles BLE proxy fragments and rejects orphan continuations', () => {
    const data = Buffer.alloc(66, 42);
    const fragments = proxyFragments(0, data);
    expect(fragments.every((fragment) => fragment.length <= 20)).toBe(true);
    const assembler = new ProxyAssembler();
    const results = fragments.map((fragment) => assembler.push(fragment));
    expect(results.at(-1)).toEqual({ type: 0, data });
    expect(() => new ProxyAssembler().push(fragments[1])).toThrow('Unexpected proxy continuation');
  });
});

describe('actual Amaran packet encoding', () => {
  it('encodes SDK-compatible power and read requests', () => {
    expect(powerPacket(true).toString('hex')).toBe('8d00000000000000018c');
    expect(powerPacket(false).toString('hex')).toBe('8c00000000000000008c');
    expect(readStatePacket().toString('hex')).toBe('0e00000000000000000e');
  });
  it('uses ten-kelvin CCT units and preserves tenth-percent brightness', () => {
    const packet = cctPacket(3200, 10);
    const bits = packet.readBigUInt64LE() | (BigInt(packet[8]) << 64n);
    expect(Number((bits >> 52n) & 1023n)).toBe(320);
    expect(Number((bits >> 62n) & 1023n)).toBe(10);
    expect(packet[4]).toBe(0);
    expect(brightnessPacket(1)[7]).toBe(64);
  });
  it('decodes hardware-captured on/off and CCT replies', () => {
    expect(decodeState(Buffer.from('da010000004001940202', 'hex'))).toMatchObject({
      sleep: false,
      intensity: 10,
      cct: 3200,
      mode: 'cct',
    });
    expect(decodeState(Buffer.from('d9000000004001940202', 'hex'))).toMatchObject({
      sleep: true,
      intensity: 10,
      cct: 3200,
    });
    expect(decodeState(Buffer.from('8d0000000040a1a80202', 'hex'))).toMatchObject({ sleep: true, cct: 6500 });
  });
  it('rejects corrupt replies and nonfinite or out-of-range commands', () => {
    expect(() => decodeState(Buffer.alloc(10, 1))).toThrow('checksum');
    for (const value of [NaN, Infinity, -1, 1001]) expect(() => brightnessPacket(value)).toThrow();
    expect(() => cctPacket(8000, 10)).toThrow();
    expect(() => hsiPacket(361, 100, 10)).toThrow();
  });
  it('encodes neutral G/M as index ten, not the old full-magenta index zero', () => {
    expect(cctPacket(3200, 10, 0).toString('hex')).toBe('59000000004001940282');
    for (const gm of [-100, -30, 0, 30, 100]) {
      const packet = cctPacket(3200, 10, gm);
      expect(Number((packet.readBigUInt64LE() >> 45n) & 127n)).toBe(gm / 10 + 10);
    }
  });
  it.each(Object.entries(EFFECTS))('uses native wire ID for %s and round-trips active parameters', (name, id) => {
    const effect = Object.keys(EFFECTS).find((key) => key === name);
    if (!effect || !Object.hasOwn(EFFECTS, effect)) throw new Error('Unknown effect');
    const options = {
      effect: name as keyof typeof EFFECTS,
      intensity: 20,
      frequency: 1,
      speed: 2,
      trigger: 2 as const,
      cct: 3200,
      gm: 30,
      palette: 0,
    };
    const packet = effectPacket(options);
    expect(packet[8]).toBe(id);
    expect(packet[9]).toBe(0x87);
    expect(decodeState(packet)).toMatchObject({
      mode: 'effect',
      effect: name,
      intensity: 20,
      frequency: 1,
      ...(['lightning', 'faulty-bulb', 'pulsing', 'strobe', 'explosion'].includes(name) ? { trigger: 2 } : {}),
    });
  });
  it('encodes the separate HSI effect layout without CCT/G/M overlap', () => {
    const packet = effectPacket({
      effect: 'pulsing',
      intensity: 20,
      frequency: 1,
      speed: 2,
      trigger: 2,
      cct: 3200,
      gm: 0,
      palette: 0,
      hue: 120,
      saturation: 90,
    });
    expect(decodeState(packet)).toMatchObject({
      effect: 'pulsing',
      hue: 120,
      sat: 90,
      speed: 2,
      trigger: 2,
      intensity: 20,
      frequency: 1,
    });
    expect(decodeState(packet)?.cct).toBeUndefined();
    expect(decodeState(packet)?.gm).toBeUndefined();
  });
  it('decodes fan telemetry and rejects unknown or inherited-property mode names', () => {
    const packet = Buffer.alloc(10);
    packet[3] = 0x40;
    packet[4] = 4;
    packet[5] = 35;
    packet.writeUInt16LE(1200, 6);
    packet[8] = 1;
    packet[9] = 9;
    packet[0] = packet.subarray(1).reduce((sum, byte) => sum + byte, 0) & 255;
    expect(decodeFan(packet)).toMatchObject({
      mode: 1,
      speed: 1200,
      temperature: 35,
      supported: { smart: true, medium: true },
    });
    expect(fanPacket('smart')[8]).toBe(1);
    expect(fanPacket('medium')[8]).toBe(5);
    for (const mode of ['auto', '__proto__', 'toString', -1, 8, 0.5, NaN]) expect(() => parseFanMode(mode)).toThrow();
  });
  it('encodes all native modes and the SDK manual-RPM field without truncation', () => {
    for (const [name, code] of Object.entries(FAN_MODES)) {
      expect(parseFanMode(` ${name.toUpperCase()} `)).toBe(name);
      expect(parseFanMode(code)).toBe(name);
      expect(parseFanMode(String(code))).toBe(name);
      const packet = fanPacket(parseFanMode(name), name === 'manual' ? 2200 : undefined);
      expect(packet[8]).toBe(code);
      expect(packet[9]).toBe(0x89);
    }
    expect(fanPacket('manual', 2200).toString('hex')).toBe('29000000000098080089');
    expect(fanPacket('off').toString('hex')).toBe('8c000000000000000389');
    expect(fanPacket('manual', 65535).readUInt16LE(6)).toBe(65535);
    for (const rpm of [undefined, -1, 65536, 0.5, NaN, Infinity]) expect(() => fanPacket('manual', rpm)).toThrow();
    expect(() => fanPacket('smart', 0)).toThrow('only valid');
  });
});

describe('persistent mesh sequence identity', () => {
  function directory() {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-sequence-test-'));
    dirs.push(directory);
    atomicJson(path.join(directory, 'sequence.json'), { networkId: 'test', source: 32766, next: 0 });
    return directory;
  }
  it('reserves counters before use and never reuses them after restart', () => {
    const dir = directory();
    const first = new SequenceStore(dir, 'test', 32766);
    expect(first.take()).toBe(0);
    expect(JSON.parse(readFileSync(path.join(dir, 'sequence.json'), 'utf8')).next).toBe(128);
    expect(() => new SequenceStore(dir, 'test', 32766)).toThrow('locked');
    first.close();
    const next = new SequenceStore(dir, 'test', 32766);
    expect(next.take()).toBe(128);
    next.close();
  });
  it('fails closed on identity mismatch, missing state and counter exhaustion', () => {
    const dir = directory();
    expect(() => new SequenceStore(dir, 'other', 32766)).toThrow('identity changed');
    atomicJson(path.join(dir, 'sequence.json'), { networkId: 'test', source: 32766, next: 0x1000000 });
    const exhausted = new SequenceStore(dir, 'test', 32766);
    expect(() => exhausted.take()).toThrow('exhausted');
    exhausted.close();
    rmSync(path.join(dir, 'sequence.json'));
    expect(() => new SequenceStore(dir, 'test', 32766)).toThrow('missing');
  });
  it('rejects overlapping fixture and controller addresses', () => {
    expect(() => MeshConfigSchema.parse({ ...config, source: 7 })).toThrow();
    expect(() => MeshConfigSchema.parse({ ...config, source: 1 })).toThrow();
    expect(() => MeshConfigSchema.parse({ ...config, lights: [config.lights[0], config.lights[0]] })).toThrow();
  });
});

describe('verified command execution', () => {
  it('persists manual overrides and checks them atomically before automatic CCT', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-override-'));
    dirs.push(directory);
    const link = fakeLink();
    const controller = new VerifiedController(config, link, new LocalLibrary(directory));
    const results = await Promise.all([
      controller.execute('back', 'hsi', { hue: 120, saturation: 100, brightness: 1 }),
      controller.automaticCct('back', { kelvin: 5600, brightness: 5 }),
    ]);
    expect(results[1]).toMatchObject({ skipped: true, reason: 'manual-override' });
    expect(link.states.get(10)?.mode).toBe('hsi');
    const restarted = new VerifiedController(config, link, new LocalLibrary(directory));
    await expect(restarted.automaticCct('back', { kelvin: 5600 })).resolves.toMatchObject({ skipped: true });
    await restarted.override(['back'], 0);
    await expect(restarted.automaticCct('back', { kelvin: 5600 })).resolves.toMatchObject({
      skipped: false,
      state: { cct: 5600 },
    });
    expect(restarted.overrideStatus(['back']).back).toBe(0);
    await restarted.override(['back'], 1);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect(restarted.overrideStatus(['back']).back).toBe(0);
  });
  it('skips automatic changes for sleeping, stopped-cooling and thermally protected fixtures', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.automaticCct('desk', { kelvin: 3200 })).resolves.toMatchObject({
      skipped: true,
      reason: 'light-off',
    });
    link.state.sleep = false;
    const fan = link.fans.get(6);
    if (!fan) throw new Error('No fan');
    fan.mode = 3;
    await expect(controller.automaticCct('desk', { kelvin: 3200 })).resolves.toMatchObject({
      skipped: true,
      reason: 'stopped-cooling',
    });
    fan.highTemperature = true;
    await expect(controller.automaticCct('desk', { kelvin: 3200 })).resolves.toMatchObject({
      skipped: true,
      reason: 'thermal-protection',
    });
    expect(link.send).not.toHaveBeenCalled();
  });
  it('captures fan profiles and restores sleeping scenes without flashing their remembered brightness', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    const snapshot = await controller.snapshot();
    expect(snapshot.back.fan).toEqual({ mode: 'smart' });
    await controller.fan('back', 'medium');
    link.send.mockClear();
    await controller.restore(snapshot);
    expect(link.fans.get(10)?.mode).toBe(1);
    const cctWrites = link.send.mock.calls.filter(([, data]) => data[9] === 0x82);
    for (const [, data] of cctWrites)
      expect(Number(((data.readBigUInt64LE() | (BigInt(data[8]) << 64n)) >> 62n) & 1023n)).toBe(0);
    expect(link.state).toMatchObject({ sleep: true, intensity: 10 });
  });
  it('stops effects for a logical group while preserving each fixture previous mode and power', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await controller.execute('back', 'hsi', { hue: 120, saturation: 100, brightness: 1 });
    await controller.execute('desk', 'effect', { name: 'pulsing', brightness: 0 });
    await controller.execute('back', 'effect', { name: 'pulsing', brightness: 0 });
    const restored = await controller.batch(['desk', 'back'], 'effect-stop', {});
    expect(restored.states.desk).toMatchObject({ mode: 'cct', sleep: true, intensity: 10 });
    expect(restored.states.back).toMatchObject({ mode: 'hsi', sleep: false, hue: 120 });
  });
  it('interpolates CCT/tint and shortest-path hue, crossing color modes through zero', () => {
    const from = { ...initial, sleep: false, mode: 'hsi' as const, hue: 350, sat: 100 };
    expect(interpolateState(from, { ...from, hue: 10 }, 0.5)).toMatchObject({ hue: 0 });
    expect(interpolateState({ ...initial, gm: -20 }, { ...initial, cct: 5200, gm: 20 }, 0.5)).toMatchObject({
      cct: 4200,
      gm: 0,
    });
    expect(interpolateState({ ...initial, sleep: false }, from, 0.5).intensity).toBe(0);
  });
  it('transitions steady settings and rejects unsupported target groups before writes', async () => {
    const link = fakeLink();
    link.state.sleep = false;
    const controller = new VerifiedController(config, link);
    await expect(controller.transition(['desk', 'back'], 'hsi', { hue: 120, saturation: 100 }, 1)).rejects.toThrow(
      'does not support'
    );
    expect(link.send).not.toHaveBeenCalled();
    await expect(controller.transition(['desk'], 'cct', { kelvin: 4500, brightness: 2 }, 1)).resolves.toMatchObject({
      states: { desk: { cct: 4500, intensity: 20, sleep: false } },
    });
    await expect(controller.transition(['back'], 'hsi', { hue: 120, saturation: 100 }, 1)).resolves.toMatchObject({
      states: { back: { mode: 'hsi', hue: 120, sleep: true } },
    });
  });
  it('cancels a transition without restoring its target or sending later frames', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    const cancel = new AbortController();
    const operation = controller.transition(['desk'], 'cct', { kelvin: 5600 }, 1, cancel.signal);
    setTimeout(() => cancel.abort(), 30);
    await expect(operation).rejects.toThrow('intermediate settings');
    expect(link.send).not.toHaveBeenCalled();
  });
  it('renames local groups without changing their identity or membership', () => {
    const library = new LocalLibrary();
    const group = library.createGroup('Old');
    library.updateGroup(group.id, 'desk', false);
    expect(library.renameGroup(group.id, 'New')).toEqual({ ...group, name: 'New', members: ['desk'] });
    library.createGroup('Other');
    expect(() => library.renameGroup(group.id, 'OTHER')).toThrow('already exists');
  });
  it('decodes native product/version fields without inventing a semantic firmware version', () => {
    const data = packet(0, (12n << 16n) | (11n << 22n) | (13n << 28n) | (65n << 43n) | (27n << 50n) | (39n << 66n));
    expect(decodeProductInfo(data)).toMatchObject({
      driverHardware: 12,
      controllerSoftware: 11,
      controllerHardware: 13,
      protocolVersion: 39,
      cctMin: 2700,
      cctMax: 6500,
    });
    data[0] ^= 1;
    expect(() => decodeProductInfo(data)).toThrow('checksum');
  });
  it('sends trigger requests once and distinguishes settings verification from an event acknowledgement', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await controller.execute('desk', 'effect', { name: 'lightning', brightness: 0 });
    link.send.mockClear();
    const result = await controller.execute('desk', 'effect-trigger', {});
    expect(result).toMatchObject({
      effect: 'lightning',
      intensity: 0,
      triggerRequest: { sent: true, eventConfirmed: false },
    });
    expect(link.send).toHaveBeenCalledOnce();
    expect(Number((link.send.mock.calls[0][1].readBigUInt64LE() >> 31n) & 3n)).toBe(1);
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('No send');
    link.send.mockImplementation(async (address, data) => {
      await send(address, data);
      link.readState.mockRejectedValue(new Error('lost reply'));
    });
    link.send.mockClear();
    await expect(controller.execute('desk', 'effect-trigger', {})).rejects.toThrow('not retried');
    expect(link.send).toHaveBeenCalledOnce();
  });
  it('reports a common applied value for groups without inventing one for mixed results', () => {
    expect(getAppliedNumber({ states: { desk: { cct: 4500 }, front: { cct: 4500 } } }, 'cct')).toBe(4500);
    expect(getAppliedNumber({ states: { desk: { cct: 4500 }, front: { cct: 3200 } } }, 'cct')).toBeUndefined();
    expect(getAppliedNumber({ intensity: 20 }, 'intensity')).toBe(20);
  });
  it('preserves 150c tint across CCT changes and rejects tint on 200x before any traffic', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.execute('back', 'gm', { value: 32 })).resolves.toMatchObject({
      gm: 30,
      cct: 3200,
      intensity: 10,
    });
    await expect(controller.execute('back', 'cct', { kelvin: 5600 })).resolves.toMatchObject({ gm: 30, cct: 5600 });
    const count = link.send.mock.calls.length;
    await expect(controller.execute('desk', 'gm', { value: 0 })).rejects.toThrow('does not support G/M');
    expect(link.send).toHaveBeenCalledTimes(count);
  });
  it('clamps relative controls and maps named colors through actual HSI', async () => {
    const controller = new VerifiedController(config, fakeLink());
    await expect(controller.execute('desk', 'increment-brightness', { delta: -10 })).resolves.toMatchObject({
      intensity: 0,
    });
    await expect(controller.execute('desk', 'increment-cct', { delta: 5000 })).resolves.toMatchObject({ cct: 6500 });
    await expect(controller.execute('back', 'color', { color: '#0f0', brightness: 1 })).resolves.toMatchObject({
      mode: 'hsi',
      hue: 120,
      sat: 100,
    });
    await expect(controller.execute('back', 'gm', { value: 0 })).rejects.toThrow('CCT mode');
  });
  it('prevalidates the whole batch, broadcasts once, and reports actual states', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.batch(['back', 'desk'], 'hsi', { hue: 120, saturation: 100 })).rejects.toThrow(
      'does not support'
    );
    expect(link.send).not.toHaveBeenCalled();
    await expect(controller.batch(['back'], 'brightness', { value: 2 }, true)).rejects.toThrow('whole mesh');
    const result = await controller.batch(['desk', 'back'], 'brightness', { value: 2 }, true);
    expect(result.delivery).toBe('mesh-broadcast');
    expect(link.send).toHaveBeenCalledTimes(1);
    expect(link.send.mock.calls[0][0]).toBe(0xffff);
    expect(Object.values(result.states).map((state) => state.intensity)).toEqual([20, 20]);
  });
  it('rejects unequal broadcast settings before writes and repairs missing batch delivery', async () => {
    const link = fakeLink();
    link.state.intensity = 30;
    const controller = new VerifiedController(config, link);
    await expect(controller.batch(['desk', 'back'], 'cct', { kelvin: 3200 }, true)).rejects.toThrow('identical');
    expect(link.send).not.toHaveBeenCalled();
    link.send.mockResolvedValueOnce(undefined);
    await expect(controller.batch(['desk', 'back'], 'brightness', { value: 2 }, true)).resolves.toMatchObject({
      states: { desk: { intensity: 20 }, back: { intensity: 20 } },
    });
    expect(link.send.mock.calls.map(([address]) => address)).toEqual([0xffff, 6, 10]);
  });
  it('enables advertised profiles on both models and refuses unsupported or thermally locked changes', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.fan('back', 'off')).rejects.toThrow('does not advertise');
    await expect(controller.fan('desk', 'max')).rejects.toThrow('does not advertise');
    expect(link.send).not.toHaveBeenCalled();
    await expect(controller.fan('back', ' Medium ')).resolves.toMatchObject({
      mode: 5,
      modeName: 'medium',
      allowedModes: ['smart', 'medium'],
    });
    await expect(controller.fan('desk', 'medium')).resolves.toMatchObject({ mode: 5, speed: 1500 });
    const fan = link.fans.get(6);
    if (!fan) throw new Error('No test fan');
    fan.highTemperature = true;
    await expect(controller.fan('desk', 'medium')).rejects.toThrow('Thermal protection');
    await expect(controller.fan('desk', 'smart')).rejects.toThrow('Thermal protection');
    await expect(controller.fan('desk')).resolves.toMatchObject({ highTemperature: true, allowedModes: [] });
  });
  it('preserves native effect parameters during changes and restores saved steady state after restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-library-test-'));
    dirs.push(directory);
    const link = fakeLink();
    const controller = new VerifiedController(config, link, new LocalLibrary(directory));
    await expect(
      controller.execute('back', 'effect', {
        name: 'pulsing',
        hue: 120,
        saturation: 90,
        frequency: 1,
        speed: 4,
        brightness: 2,
      })
    ).resolves.toMatchObject({ mode: 'effect', hue: 120, sat: 90, speed: 4 });
    await expect(controller.execute('back', 'effect-intensity', { value: 3 })).resolves.toMatchObject({
      hue: 120,
      sat: 90,
      speed: 4,
      intensity: 30,
    });
    await expect(controller.execute('back', 'effect-speed', { value: 7 })).resolves.toMatchObject({
      frequency: 7,
      speed: 4,
    });
    await expect(controller.execute('back', 'effect-animation-speed', { value: 2 })).resolves.toMatchObject({
      frequency: 7,
      speed: 2,
    });
    await controller.execute('back', 'effect', { name: 'fire', brightness: 2, frequency: 1 });
    const writes = link.send.mock.calls.length;
    await expect(controller.execute('back', 'effect-animation-speed', { value: 2 })).rejects.toThrow(
      'no animation speed'
    );
    expect(link.send).toHaveBeenCalledTimes(writes);
    const restarted = new VerifiedController(config, link, new LocalLibrary(directory));
    await expect(restarted.execute('back', 'effect-stop', {})).resolves.toMatchObject({
      mode: 'cct',
      cct: 3200,
      gm: 0,
      intensity: 10,
      sleep: true,
    });
    const count = link.send.mock.calls.length;
    await restarted.execute('back', 'effect-stop', {});
    expect(link.send).toHaveBeenCalledTimes(count);
  });
  it('accepts zero RPM as telemetry rather than falsely diagnosing an unverified profile', async () => {
    const link = fakeLink();
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing fake send');
    link.send.mockImplementation(async (address, payload) => {
      await send(address, payload);
      const fan = link.fans.get(address);
      if (fan && payload[9] === 0x89 && payload[8] === 5) fan.speed = 0;
    });
    const controller = new VerifiedController(config, link);
    for (const key of ['desk', 'back']) {
      await expect(controller.fan(key, 'medium')).resolves.toMatchObject({
        mode: 5,
        speed: 0,
        rpmStatus: 'zero-reported',
      });
      await expect(controller.fan(key, '5')).resolves.toMatchObject({ mode: 5, speed: 0 });
    }
    expect(link.send.mock.calls.map(([, payload]) => payload[8])).toEqual([5, 5]);
    expect(link.readState).not.toHaveBeenCalled();
  });
  it('supports all eight native modes when the fixture advertises them', async () => {
    const link = fakeLink();
    const fan = link.fans.get(10);
    if (!fan) throw new Error('Missing test fan');
    for (const name of Object.keys(FAN_MODES)) fan.supported[parseFanMode(name)] = true;
    const controller = new VerifiedController(config, link);
    expect((await controller.fan('back')).allowedModes).toEqual(Object.keys(FAN_MODES));
    for (const [name, code] of Object.entries(FAN_MODES)) {
      await expect(
        controller.fan('back', code, undefined, name === 'manual' ? 2200 : undefined)
      ).resolves.toMatchObject({ mode: code, modeName: name });
    }
    expect(link.send.mock.calls.every(([, payload]) => payload[9] === 0x89)).toBe(true);
    expect(link.states.get(10)).toMatchObject(initial);
  });
  it('requires explicit manual RPM and refuses stopped cooling while LEDs emit light', async () => {
    const link = fakeLink();
    const fan = link.fans.get(6);
    if (!fan) throw new Error('Missing test fan');
    fan.supported.manual = true;
    fan.supported.off = true;
    link.state.sleep = false;
    const controller = new VerifiedController(config, link);
    await expect(controller.fan('desk', 'manual')).rejects.toThrow('explicit RPM');
    await expect(controller.fan('desk', 'smart', undefined, 2200)).rejects.toThrow('only valid');
    await expect(controller.fan('desk', undefined, undefined, 2200)).rejects.toThrow('requires manual');
    await expect(controller.fan('desk', 'off')).rejects.toThrow('stopped cooling');
    await expect(controller.fan('desk', 'manual', undefined, 0)).rejects.toThrow('stopped cooling');
    expect(link.send).not.toHaveBeenCalled();
    link.state.intensity = 0;
    await expect(controller.fan('desk', 'manual', undefined, 0)).resolves.toMatchObject({ mode: 0, speed: 0 });
    await expect(controller.fan('desk', 'off')).resolves.toMatchObject({ mode: 3, speed: 0 });
  });
  it('checks manual RPM as well as mode and restores Smart after a mismatched speed', async () => {
    const link = fakeLink();
    const fan = link.fans.get(10);
    if (!fan) throw new Error('Missing test fan');
    fan.supported.manual = true;
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing test send');
    link.send.mockImplementation(async (address, payload) => {
      await send(address, payload);
      if (payload[8] === 0) fan.speed = 1200;
    });
    await expect(new VerifiedController(config, link).fan('back', 'manual', undefined, 2200)).rejects.toThrow(
      'mode/RPM did not verify'
    );
    expect(fan.mode).toBe(1);
    expect(link.send.mock.calls.map(([, payload]) => payload[8])).toEqual([0, 1]);
  });
  it('prevalidates stopped-cooling requests for the entire batch', async () => {
    const link = fakeLink();
    for (const fan of link.fans.values()) fan.supported.off = true;
    const back = link.states.get(10);
    if (!back) throw new Error('Missing test state');
    back.sleep = false;
    await expect(new VerifiedController(config, link).fans(['desk', 'back'], 'off')).rejects.toThrow('stopped cooling');
    expect(link.send).not.toHaveBeenCalled();
  });
  it('prevalidates every fan target before writes and reports partial delivery explicitly', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    const back = link.fans.get(10);
    if (!back) throw new Error('Missing test fan');
    back.supported.medium = false;
    await expect(controller.fans(['desk', 'back'], 'medium')).rejects.toThrow('does not advertise');
    expect(link.send).not.toHaveBeenCalled();
    back.supported.medium = true;
    back.highTemperature = true;
    await expect(controller.fans(['desk', 'back'], 'medium')).rejects.toThrow('Thermal protection');
    expect(link.send).not.toHaveBeenCalled();
    back.highTemperature = false;
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing test send');
    link.send.mockImplementation(async (address, payload) => {
      if (address === 10) throw new Error('write failed');
      await send(address, payload);
    });
    await expect(controller.fans(['desk', 'back'], 'medium')).rejects.toThrow('verified targets: desk');
    expect(link.fans.get(6)?.mode).toBe(5);
    expect(back.mode).toBe(1);
  });
  it('stops on a thermal trip without trying to restart the fan or lamp', async () => {
    const link = fakeLink();
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing test send');
    link.send.mockImplementation(async (address, payload) => {
      await send(address, payload);
      const fan = link.fans.get(address);
      if (fan) fan.highTemperature = true;
    });
    await expect(new VerifiedController(config, link).fan('back', 'medium')).rejects.toThrow('Thermal protection');
    expect(link.send.mock.calls.map(([, payload]) => payload[9])).toEqual([0x89]);
  });
  it('recovers genuine mode mismatches to Smart without substituting success', async () => {
    const link = fakeLink();
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing test send');
    link.send.mockImplementation(async (address, payload) => {
      await send(address, payload);
      const fan = link.fans.get(address);
      if (fan && payload[8] === 5) fan.mode = 4;
    });
    await expect(new VerifiedController(config, link).fan('desk', 'medium')).rejects.toThrow(
      'Smart automatic cooling is confirmed'
    );
    expect(link.fans.get(6)?.mode).toBe(1);
    expect(link.send.mock.calls.map(([, payload]) => payload[8])).toEqual([5, 1]);
  });
  it('does not run Smart recovery if a subsequent read discovers thermal protection', async () => {
    const link = fakeLink();
    const fan = link.fans.get(6);
    if (!fan) throw new Error('Missing test fan');
    link.send.mockImplementation(async () => {
      fan.mode = 4;
    });
    let reads = 0;
    link.readFan.mockImplementation(async () => ({ ...fan, highTemperature: ++reads >= 8 }));
    await expect(new VerifiedController(config, link).fan('desk', 'medium')).rejects.toThrow('Thermal protection');
    expect(link.send).toHaveBeenCalledOnce();
  });
  it('reconnects fan reads and rejects cancelled or empty operations before mutation', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    link.readFan.mockRejectedValueOnce(new Error('disconnected'));
    await expect(controller.fan('back')).resolves.toMatchObject({ mode: 1, rpmStatus: 'rotation-reported' });
    expect(link.connect).toHaveBeenCalledOnce();
    await expect(controller.fans([], 'medium')).rejects.toThrow('nonempty');
    await expect(controller.fans(['back', 'back'], 'medium')).rejects.toThrow('unique');
    const cancel = new AbortController();
    cancel.abort();
    await expect(controller.fans(['back'], 'medium', cancel.signal)).rejects.toThrow();
    expect(link.send).not.toHaveBeenCalled();
  });
  it('reports failed cooling recovery without touching power or intensity', async () => {
    const link = fakeLink();
    const fan = link.fans.get(6);
    if (!fan) throw new Error('Missing test fan');
    link.send.mockImplementation(async () => {
      fan.mode = 4;
    });
    await expect(new VerifiedController(config, link).fan('desk', 'medium')).rejects.toThrow(
      'recovery could not be verified'
    );
    expect(link.send.mock.calls.map(([, payload]) => payload[9])).toEqual([0x89, 0x89]);
  });
  it('cancels remaining fan targets and only performs safe recovery after an in-flight write', async () => {
    const link = fakeLink();
    const send = link.send.getMockImplementation();
    if (!send) throw new Error('Missing test send');
    const cancel = new AbortController();
    link.send.mockImplementation(async (address, payload) => {
      await send(address, payload);
      if (payload[8] === 5) cancel.abort();
    });
    await expect(new VerifiedController(config, link).fans(['desk', 'back'], 'medium', cancel.signal)).rejects.toThrow(
      'Fan batch stopped'
    );
    expect(link.send.mock.calls.map(([address, payload]) => [address, payload[8]])).toEqual([
      [6, 5],
      [6, 1],
    ]);
    expect(link.fans.get(10)?.mode).toBe(1);
  });
  it('rejects malformed fan telemetry instead of replacing it with zero RPM', async () => {
    const link = fakeLink();
    const fan = link.fans.get(10);
    if (!fan) throw new Error('Missing test fan');
    link.readFan.mockResolvedValue({ ...fan, speed: -1 });
    await expect(new VerifiedController(config, link).fan('back', 'medium')).rejects.toThrow();
    expect(link.send).not.toHaveBeenCalled();
  });
  it('rejects unsupported effect variants and meaningless parameters before traffic', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    for (const args of [
      { name: 'strobe' },
      { name: 'fire', kelvin: 3200 },
      { name: 'fire', speed: 2 },
      { name: 'pulsing', hue: 120, saturation: 100, gm: 0 },
    ]) {
      await expect(controller.execute('back', 'effect', args)).rejects.toThrow();
    }
    expect(link.send).not.toHaveBeenCalled();
  });
  it('fades at bounded cadence, preserves power, and cancels before more writes', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.fade(['desk', 'back'], 2, 0.5)).resolves.toMatchObject({
      states: { desk: { intensity: 20, sleep: true }, back: { intensity: 20, sleep: true } },
    });
    const cancel = new AbortController();
    const operation = controller.fade(['desk'], 5, 1, cancel.signal);
    setTimeout(() => cancel.abort(), 20);
    await expect(operation).rejects.toThrow('intermediate brightness');
    expect(link.state.intensity).toBe(20);
    expect(link.send).toHaveBeenCalledTimes(2);
  });
  it('persists local libraries and rejects incompatible preset recalls before changing any fixture', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'amaran-library-test-'));
    dirs.push(directory);
    const library = new LocalLibrary(directory);
    const group = library.createGroup('Work');
    library.updateGroup(group.id, 'desk', false);
    library.save('scenes', 'Evening', { desk: initial, back: initial });
    const loaded = new LocalLibrary(directory);
    expect(loaded.group('work').members).toEqual(['desk']);
    expect(loaded.find('scenes', 'evening').states.back.gm).toBe(0);
    expect(() => loaded.save('presets', 'Bad', { desk: initial, back: initial })).toThrow('exactly one');
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(
      controller.restore({ back: initial, desk: { ...initial, mode: 'hsi', hue: 120, sat: 100 } })
    ).rejects.toThrow('does not support');
    await expect(controller.restore({ desk: { ...initial, gm: 30 } })).rejects.toThrow('non-neutral G/M');
    expect(link.send).not.toHaveBeenCalled();
    expect((await controller.snapshot()).desk.gm).toBeUndefined();
    loaded.delete('scenes', 'Evening');
    expect(new LocalLibrary(directory).list('scenes')).toEqual([]);
  });
  it('validates model capabilities before sending anything', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    expect(capabilities(config.lights[0])).toMatchObject({ hsi_support: false, cct_min: 2700, cct_max: 6500 });
    await expect(controller.execute('desk', 'hsi', { hue: 0, saturation: 100, brightness: 1 })).rejects.toThrow(
      'does not support'
    );
    await expect(controller.execute('desk', 'cct', { kelvin: 7500 })).rejects.toThrow('6500');
    expect(() => validateAction(config.lights[0], 'cct', { kelvin: 3200, gm: 50 })).toThrow('does not support G/M');
    expect(link.send).not.toHaveBeenCalled();
    expect(link.readState).not.toHaveBeenCalled();
  });
  it('preserves actual brightness when CCT omits brightness', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.execute('desk', 'cct', { kelvin: 5600 })).resolves.toMatchObject({
      intensity: 10,
      sleep: false,
      cct: 5600,
    });
    expect(link.readState).toHaveBeenCalledTimes(2);
  });
  it('quantizes fractional requests to the fixtures whole-percent dimming resolution', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    await expect(controller.execute('desk', 'brightness', { value: 1.2 })).resolves.toMatchObject({ intensity: 10 });
    await expect(controller.execute('back', 'cct', { kelvin: 4542, brightness: 1.8 })).resolves.toMatchObject({
      intensity: 20,
      cct: 4500,
    });
  });
  it('serializes concurrent commands and toggles against fresh state', async () => {
    const link = fakeLink();
    const controller = new VerifiedController(config, link);
    const results = await Promise.all([
      controller.execute('desk', 'toggle', {}),
      controller.execute('desk', 'toggle', {}),
    ]);
    expect(results.map((state) => state.sleep)).toEqual([false, true]);
  });
  it('reconnects after a failed state read', async () => {
    const link = fakeLink();
    vi.mocked(link.readState).mockRejectedValueOnce(new Error('disconnected'));
    await expect(new VerifiedController(config, link).execute('desk', 'state', {})).resolves.toMatchObject({
      ...initial,
      observedAt: expect.any(String),
    });
    expect(link.connect).toHaveBeenCalledOnce();
  });
  it('never reports success when writes do not change the actual fixture', async () => {
    const link = fakeLink();
    vi.mocked(link.send).mockResolvedValue(undefined);
    await expect(new VerifiedController(config, link).execute('desk', 'on', {})).rejects.toThrow('Unable to verify');
    expect(link.send).toHaveBeenCalledTimes(3);
  });
  it('does not apply requests cancelled before execution', async () => {
    const link = fakeLink();
    const cancel = new AbortController();
    cancel.abort();
    await expect(new VerifiedController(config, link).execute('desk', 'on', {}, cancel.signal)).rejects.toThrow();
    expect(link.send).not.toHaveBeenCalled();
  });
  it('serves truthful state and model capabilities through the existing CLI client', async () => {
    const link = fakeLink();
    const circadianStatus = {
      generatedAt: '2026-09-13T22:30:00.000Z',
      service: {
        installed: true,
        loaded: true,
        active: true,
        healthy: true,
        intervalSeconds: 60,
        curve: 'cie-daylight',
        weatherConfigured: false,
        lastRunAt: '2026-09-13T22:29:38.000Z',
        lastTarget: { cct: 6002, intensity: 25 },
      },
      settings: {
        enabled: true,
        intervalSeconds: 60,
        curve: 'cie-daylight',
        weather: false,
        cctMin: 1700,
        cctMax: 6500,
        intensityMin: 5,
        intensityMax: 25,
      },
      current: {
        time: '2026-09-13T22:30:00.000Z',
        cct: 6000,
        intensity: 25,
        curve: 'cie-daylight',
        weatherActive: false,
        weatherSource: 'none',
      },
      schedule: {
        date: '2026-09-13',
        timeZone: 'America/Los_Angeles',
        intervalMinutes: 15,
        intensityLimit: 25,
        points: [
          {
            time: '2026-09-13T07:00:00.000Z',
            cct: 2000,
            intensity: 5,
            appliedIntensity: 5,
            sunlightLux: 0,
            systemCapacityLux: 9500,
          },
          {
            time: '2026-09-14T07:00:00.000Z',
            cct: 2000,
            intensity: 5,
            appliedIntensity: 5,
            sunlightLux: 0,
            systemCapacityLux: 9500,
          },
        ],
      },
    } satisfies CircadianDashboardStatus;
    const updateCircadianSettings = vi.fn(async () => circadianStatus);
    const server = createBleServer(new VerifiedController(config, link), undefined, {
      circadianStatus: async () => circadianStatus,
      updateCircadianSettings,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    try {
      const url = `http://127.0.0.1:${address.port}`;
      const client = await BleHttpController.connect(url);
      await expect(commandCallbackResult((callback) => client.saveScene('Baseline', callback))).resolves.toMatchObject({
        data: { name: 'Baseline', states: { back: { gm: 0 } } },
      });
      await commandCallbackResult((callback) => client.createGroup('Work', callback));
      await commandCallbackResult((callback) => client.addToGroup('Work', 'desk', callback));
      const withGroups = await BleHttpController.connect(url);
      expect(getLightDevices(withGroups.getDevices())).toHaveLength(2);
      const group = withGroups.getDevices().find((device) => device.device_type === 'ble-group');
      if (!group?.node_id) throw new Error('Missing logical group');
      await commandCallbackResult((callback) => withGroups.setIntensity(group.node_id as string, 20, callback));
      expect(link.state.intensity).toBe(20);
      expect(link.states.get(10)?.intensity).toBe(10);
      await expect(
        commandCallbackResult((callback) => withGroups.getNodeConfig(group.node_id as string, callback))
      ).resolves.toMatchObject({
        data: { work_mode: 'group', member_states: { desk: { intensity: 20, cct: 3200 } } },
      });
      await commandCallbackResult((callback) => client.recallScene('Baseline', callback));
      expect(link.state.intensity).toBe(10);
      await expect(
        commandCallbackResult((callback) => client.setHSI('back', 120, 100, 10, 3200, 0, callback))
      ).rejects.toThrow('basic HSI');
      await expect(commandCallbackResult((callback) => client.getFanInfo('back', callback))).resolves.toMatchObject({
        mode: 1,
        temperature: 35,
      });
      await expect(
        commandCallbackResult((callback) => withGroups.fanStates([group.node_id as string, 'desk'], 'medium', callback))
      ).resolves.toMatchObject({
        states: { desk: { mode: 5, modeName: 'medium' } },
      });
      expect(link.fans.get(10)?.mode).toBe(1);
      await expect(
        commandCallbackResult((callback) => withGroups.getFanInfo(group.node_id as string, callback))
      ).resolves.toMatchObject({ states: { desk: { mode: 5 } } });
      await expect(
        commandCallbackResult((callback) => withGroups.setFanMode(group.node_id as string, 1, callback))
      ).resolves.toMatchObject({ states: { desk: { mode: 1 } } });
      await expect(
        commandCallbackResult((callback) => withGroups.getFanSpeed(group.node_id as string, callback))
      ).rejects.toThrow('separate fan states');
      const fanProgram = new Command();
      registerFan(fanProgram, {
        createController: async () => withGroups,
        findDevice: (controller, query) => controller.getDevices().find((device) => device.node_id === query) ?? null,
        asyncCommand: (fn) => fn,
      });
      const fanOutput = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await fanProgram.parseAsync(['node', 'test', 'fan', 'mode', 'all', 'medium', '--backend', 'ble', '--json']);
      const fanJson = JSON.parse(String(fanOutput.mock.calls.at(-1)?.[0]));
      expect(fanJson.states).toMatchObject({ desk: { mode: 5 }, back: { mode: 5 } });
      await fanProgram.parseAsync(['node', 'test', 'fan', 'info', '--backend', 'ble', '--json']);
      expect(JSON.parse(String(fanOutput.mock.calls.at(-1)?.[0])).states.back.allowedModes).toEqual([
        'smart',
        'medium',
      ]);
      fanOutput.mockRestore();
      const allFans = await (await fetch(`${url}/fans`)).json();
      expect(allFans).toMatchObject({
        ok: true,
        verified: true,
        result: { states: { desk: { mode: 5 }, back: { mode: 5 } } },
      });
      const groupFans = await (await fetch(`${url}/lights/${encodeURIComponent(group.node_id)}/fan`)).json();
      expect(Object.keys(groupFans.result.states)).toEqual(['desk']);
      const badFans = await fetch(`${url}/fans`, { method: 'POST', body: JSON.stringify({ targets: [] }) });
      expect(badFans.status).toBe(400);
      const data = await new Promise((resolve, reject) =>
        client.getNodeConfig('desk', (ok, message, result) => (ok ? resolve(result) : reject(new Error(message))))
      );
      expect(data).toMatchObject({ data: { sleep: true, intensity: 10, cct: 3200, hsi_support: false } });
      await new Promise<void>((resolve, reject) =>
        client.setCCT('desk', 5600, undefined, (ok, message) => (ok ? resolve() : reject(new Error(message))))
      );
      expect(link.state).toMatchObject({ cct: 5600, intensity: 10, sleep: false });
      const bad = await fetch(`${url}/lights/desk/hsi`, {
        method: 'POST',
        body: JSON.stringify({ hue: 0, saturation: 100, brightness: 1 }),
      });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ ok: false });
      expect((await fetch(url, { headers: { origin: 'https://example.com' } })).status).toBe(403);
      const dashboard = await fetch(`${url}/dashboard`);
      expect(dashboard.headers.get('content-security-policy')).toContain("default-src 'self'");
      const dashboardMarkup = (await dashboard.text()).toLowerCase();
      expect(dashboardMarkup).toContain('direct bluetooth mesh');
      expect(dashboardMarkup).toContain('circadian service');
      expect(dashboardMarkup).toContain('hover or slide over the graph');
      expect(dashboardMarkup).toContain('href="/favicon.svg"');
      const favicon = await fetch(`${url}/favicon.svg`);
      expect(favicon.headers.get('content-type')).toContain('image/svg+xml');
      expect(await favicon.text()).toContain('<svg');
      expect(
        (
          await fetch(`${url}/dashboard/settings`, {
            method: 'POST',
            headers: { origin: url },
            body: JSON.stringify({ title: 'Studio lights' }),
          })
        ).status
      ).toBe(200);
      const dashboardStatus = await (await fetch(`${url}/dashboard/status`)).json();
      expect(dashboardStatus).toMatchObject({
        ok: true,
        verified: true,
        result: { connected: true, lighting: { desk: {}, back: {} }, fans: { desk: {}, back: {} } },
      });
      expect(await (await fetch(`${url}/dashboard/status-cache`)).json()).toMatchObject({
        ok: true,
        result: dashboardStatus.result,
      });
      const circadianStatus = await (await fetch(`${url}/dashboard/circadian`)).json();
      expect(circadianStatus).toMatchObject({
        ok: true,
        result: {
          service: { active: true, lastTarget: { cct: 6002, intensity: 25 } },
          current: { weatherActive: false },
          schedule: { intervalMinutes: 15, intensityLimit: 25 },
        },
      });
      expect(circadianStatus.result.schedule.points[0]).toMatchObject({
        sunlightLux: 0,
        systemCapacityLux: 9500,
      });
      const updatedCircadianStatus = await (
        await fetch(`${url}/dashboard/circadian/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ curve: 'physics', weather: true }),
        })
      ).json();
      expect(updatedCircadianStatus).toMatchObject({ ok: true, result: { settings: { curve: 'cie-daylight' } } });
      expect(updateCircadianSettings).toHaveBeenCalledWith({ curve: 'physics', weather: true });
      const program = new Command();
      registerCct(program, {
        createController: async () => client,
        findDevice: (controller, query) => controller.getDevices().find((device) => device.node_id === query) ?? null,
        asyncCommand: (fn) => fn,
      });
      const previousExit = process.exitCode;
      try {
        await program.parseAsync(['node', 'test', 'cct', '7500', '--backend', 'ble']);
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = previousExit;
      }
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await program.parseAsync(['node', 'test', 'cct', '4542', 'desk', '--backend', 'ble']);
      expect(output).toHaveBeenCalledWith(expect.stringContaining('4500K (rounded from 4542K)'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('wires extended modes and manual RPM through fixture/group/all APIs and the CLI', async () => {
    const link = fakeLink();
    for (const fan of link.fans.values())
      for (const name of Object.keys(FAN_MODES)) fan.supported[parseFanMode(name)] = true;
    const library = new LocalLibrary();
    const group = library.createGroup('Fans');
    for (const key of ['desk', 'back']) library.updateGroup(group.id, key, false);
    const server = createBleServer(new VerifiedController(config, link), library);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    try {
      const url = `http://127.0.0.1:${address.port}`;
      const client = await BleHttpController.connect(url);
      await commandCallbackResult((callback) => client.fanStates([group.id], 'silent', callback));
      await expect(
        commandCallbackResult((callback) => client.setFanSpeed('back', 2200, callback))
      ).resolves.toMatchObject({ states: { back: { mode: 0, speed: 2200 } } });
      const posted = await fetch(`${url}/lights/desk/fan`, {
        method: 'POST',
        body: JSON.stringify({ mode: 0, rpm: 1800 }),
      });
      expect(await posted.json()).toMatchObject({ ok: true, verified: true, result: { mode: 0, speed: 1800 } });
      const program = new Command();
      registerFan(program, {
        createController: async () => client,
        findDevice: (controller, key) => controller.getDevices().find((device) => device.node_id === key) ?? null,
        asyncCommand: (fn) => fn,
      });
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await program.parseAsync([
        'node',
        'test',
        'fan',
        'mode',
        group.id,
        'manual',
        '--rpm',
        '2200',
        '--json',
        '--backend',
        'ble',
      ]);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).states).toMatchObject({
        desk: { mode: 0, speed: 2200 },
        back: { mode: 0, speed: 2200 },
      });
      await program.parseAsync(['node', 'test', 'fan', 'speed', 'all', '2400', '--json', '--backend', 'ble']);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0])).states).toMatchObject({
        desk: { mode: 0, speed: 2400 },
        back: { mode: 0, speed: 2400 },
      });
      await expect(
        program.parseAsync(['node', 'test', 'fan', 'mode', 'back', 'manual', '--backend', 'ble'])
      ).rejects.toThrow('explicit RPM');
      expect(link.send.mock.calls.every(([, payload]) => payload[9] === 0x89)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('exposes overrides, product reads and persistent library updates through the client', async () => {
    const link = fakeLink();
    Object.assign(link, {
      readProductInfo: vi.fn(async () => ({
        driverSoftware: 0,
        driverHardware: 12,
        controllerSoftware: 11,
        controllerHardware: 13,
        cctMin: 2700,
        cctMax: 6500,
        protocolVersion: 39,
        effects: { manual: true, music: true, picker: true, program: true, touchbar: true },
      })),
    });
    const library = new LocalLibrary();
    const server = createBleServer(new VerifiedController(config, link, library), library);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    try {
      const client = await BleHttpController.connect(`http://127.0.0.1:${address.port}`);
      await expect(commandCallbackResult((cb) => client.getProductInfo('desk', cb))).resolves.toMatchObject({
        data: { controllerSoftware: 11, protocolVersion: 39 },
      });
      await commandCallbackResult((cb) => client.setCCT('back', 3200, 10, cb));
      await expect(commandCallbackResult((cb) => client.setAutomaticCCT('back', 5600, 10, cb))).resolves.toMatchObject({
        skipped: true,
      });
      await commandCallbackResult((cb) => client.overrides(['back'], 0, cb));
      await expect(commandCallbackResult((cb) => client.setAutomaticCCT('back', 5600, 10, cb))).resolves.toMatchObject({
        skipped: false,
      });
      await commandCallbackResult((cb) => client.createGroup('Before', cb));
      await commandCallbackResult((cb) => client.addToGroup('Before', 'back', cb));
      await commandCallbackResult((cb) => client.renameGroup('Before', 'After', cb));
      expect(library.group('After').members).toEqual(['back']);
      await commandCallbackResult((cb) => client.saveSaved('scenes', 'Back only', [library.group('After').id], cb));
      expect(Object.keys(library.find('scenes', 'Back only').states)).toEqual(['back']);
      await commandCallbackResult((cb) => client.replaceSaved('scenes', 'Back only', 'All now', 'all', cb));
      expect(Object.keys(library.find('scenes', 'All now').states)).toEqual(['desk', 'back']);
      await commandCallbackResult((cb) => client.savePreset('back', 'Old preset', cb));
      await commandCallbackResult((cb) => client.updateSaved('presets', 'Old preset', 'New preset', cb));
      expect(library.find('presets', 'New preset').states.back.fan).toEqual({ mode: 'smart' });
      await commandCallbackResult((cb) => client.saveQuickshot('Old quickshot', cb));
      await commandCallbackResult((cb) => client.updateSaved('quickshots', 'Old quickshot', 'New quickshot', cb));
      expect(library.find('quickshots', 'New quickshot').states.back.cct).toBe(5600);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
