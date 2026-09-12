import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Characteristic, Peripheral } from '@abandonware/noble';
import { deadline } from './async.js';
import { MeshCrypto, type NetworkMessage } from './crypto.js';
import { packet } from './packets.js';
import { discoverUnprovisioned, type UnprovisionedDevice } from './provisioning.js';

export { deadline } from './async.js';

import { decodeProductInfo, type ProductInfo } from './settings.js';
import type { MeshConfig, SequenceStore } from './storage.js';
import { decodeFan, decodeState, type FanState, type FixtureState, readFanPacket, readStatePacket } from './telink.js';

export class ProxyAssembler {
  private partial?: { type: number; chunks: Buffer[]; length: number; started: number };
  push(data: Buffer): { type: number; data: Buffer } | undefined {
    if (data.length < 2) throw new Error('Empty proxy packet');
    const type = data[0] & 63;
    const sar = data[0] >> 6;
    if (sar === 0) {
      this.partial = undefined;
      return { type, data: data.subarray(1) };
    }
    if (sar === 1) this.partial = { type, chunks: [], length: 0, started: Date.now() };
    const partial = this.partial;
    if (!partial || partial.type !== type || Date.now() - partial.started > 10_000) {
      this.partial = undefined;
      throw new Error('Unexpected proxy continuation');
    }
    partial.chunks.push(data.subarray(1));
    partial.length += data.length - 1;
    if (partial.length > 384) {
      this.partial = undefined;
      throw new Error('Oversized proxy packet');
    }
    if (sar !== 3) return undefined;
    this.partial = undefined;
    return { type, data: Buffer.concat(partial.chunks) };
  }
}

export function proxyFragments(type: number, data: Buffer, size = 19): Buffer[] {
  if (data.length <= size) return [Buffer.concat([Buffer.from([type]), data])];
  const fragments = [];
  for (let offset = 0; offset < data.length; offset += size) {
    const sar = offset === 0 ? 1 : offset + size >= data.length ? 3 : 2;
    fragments.push(Buffer.concat([Buffer.from([(sar << 6) | type]), data.subarray(offset, offset + size)]));
  }
  return fragments;
}

interface AccessMessage {
  source: number;
  sequence: number;
  data: Buffer;
  deviceKey?: boolean;
}
interface Segments {
  chunks: Map<number, Buffer>;
  count: number;
  sequence: number;
  mic: boolean;
  started: number;
}

export class MeshTransport {
  readonly crypto: MeshCrypto;
  private peripheral?: Peripheral;
  private input?: Characteristic;
  private output?: Characteristic;
  private iv?: number;
  private assembler = new ProxyAssembler();
  private readonly events = new EventEmitter();
  private readonly segments = new Map<string, Segments>();
  private readonly received = new Map<number, { iv: number; sequence: number }>();
  private writes: Promise<void> = Promise.resolve();
  private initialized = false;
  private closing = false;

  constructor(
    readonly config: MeshConfig,
    private readonly sequences: SequenceStore,
    private readonly debug = false
  ) {
    this.crypto = new MeshCrypto(config.netKey, config.appKey);
  }

  get ready(): boolean {
    return this.initialized && this.peripheral?.state === 'connected';
  }

  private wait<T>(event: string, accept: (value: T) => boolean, milliseconds: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.events.removeListener(event, handler);
        this.events.removeListener('lost', lost);
      };
      const handler = (value: T) => {
        try {
          if (!accept(value)) return;
          cleanup();
          resolve(value);
        } catch (error) {
          cleanup();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
      const lost = () => {
        cleanup();
        reject(new Error('BLE connection lost'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`BLE ${event} response timed out`));
      }, milliseconds);
      this.events.on(event, handler);
      this.events.on('lost', lost);
    });
  }

  async connect(): Promise<void> {
    if (this.ready) return;
    const { default: noble } = await import('@abandonware/noble');
    this.closing = false;
    const candidates = new Map<string, Peripheral>();
    const discover = (peripheral: Peripheral) => {
      if (
        peripheral.advertisement.serviceData?.some(
          (service) =>
            service.uuid === '1828' &&
            this.crypto.matchesAdvertisement(
              service.data,
              this.config.lights.map((light) => light.address)
            )
        )
      )
        candidates.set(peripheral.id, peripheral);
    };
    let stateListener: ((state: string) => void) | undefined;
    try {
      if (noble._state !== 'poweredOn') {
        await deadline(
          new Promise<void>((resolve, reject) => {
            stateListener = (state) => {
              if (state === 'poweredOn') resolve();
              else if (state === 'unauthorized' || state === 'unsupported' || state === 'poweredOff')
                reject(new Error(`Bluetooth is ${state}`));
            };
            noble.on('stateChange', stateListener);
          }),
          60_000,
          'Bluetooth adapter initialization (check macOS Privacy & Security > Bluetooth permission for Node)'
        );
      }
      noble.on('discover', discover);
      await deadline(noble.startScanningAsync(['1828'], true), 5000, 'Bluetooth scan start');
      await delay(5000);
    } finally {
      if (stateListener) noble.removeListener('stateChange', stateListener);
      noble.removeListener('discover', discover);
      await deadline(noble.stopScanningAsync(), 3000, 'Bluetooth scan stop');
    }
    if (!candidates.size)
      throw new Error(
        'No proxy for the configured mesh found. Quit Amaran Desktop and verify the lights and Bluetooth permission.'
      );
    const failures: string[] = [];
    for (const peripheral of [...candidates.values()].sort((a, b) => b.rssi - a.rssi)) {
      try {
        console.error(`Connecting to mesh proxy ${peripheral.id} (${peripheral.rssi} dBm)`);
        this.peripheral = peripheral;
        peripheral.once('disconnect', () => {
          this.initialized = false;
          this.input = undefined;
          this.events.emit('lost');
        });
        await deadline(peripheral.connectAsync(), 10_000, 'BLE connect');
        const { characteristics } = await deadline(
          peripheral.discoverSomeServicesAndCharacteristicsAsync(['1828'], ['2add', '2ade']),
          8000,
          'BLE service discovery'
        );
        this.input = characteristics.find((entry) => entry.uuid === '2add');
        this.output = characteristics.find((entry) => entry.uuid === '2ade');
        if (!this.input || !this.output) throw new Error('Mesh proxy characteristics are missing');
        this.iv = undefined;
        this.assembler = new ProxyAssembler();
        this.output.on('data', this.notify);
        const beacon = this.wait<number>('beacon', () => true, 8000);
        await Promise.all([beacon, deadline(this.output.subscribeAsync(), 5000, 'BLE subscribe')]);
        await delay(500);
        await this.configureFilter(Buffer.from([0, 0]), 0);
        const addresses = Buffer.alloc(5);
        addresses[0] = 1;
        addresses.writeUInt16BE(this.config.source, 1);
        // Amaran firmware sends menu replies to the original provisioner, not the request source.
        addresses.writeUInt16BE(1, 3);
        await this.configureFilter(addresses, 2);
        this.initialized = true;
        console.error(`Authenticated mesh proxy ready (IV ${this.iv}, source ${this.config.source})`);
        return;
      } catch (error) {
        failures.push(`${peripheral.id}: ${(error as Error).message}`);
        await this.disconnect();
        this.closing = false;
      }
    }
    throw new Error(`Unable to initialize mesh proxy: ${failures.join('; ')}`);
  }

  private async configureFilter(data: Buffer, count: number): Promise<void> {
    const response = this.wait<Buffer>(
      'filter',
      (value) => value.length === 4 && value[0] === 3 && value[1] === 0 && value.readUInt16BE(2) === count,
      4000
    );
    await Promise.all([response, this.sendNetwork(0, data, true, true)]);
  }

  private async sendNetwork(
    destination: number,
    transport: Buffer,
    control: boolean,
    proxy = false,
    sequence = this.sequences.take()
  ): Promise<void> {
    if (this.iv === undefined) throw new Error('No authenticated network beacon');
    const data = this.crypto.network(
      {
        destination,
        transport,
        control,
        sequence,
        source: this.config.source,
        iv: this.iv,
      },
      proxy
    );
    const write = this.writes.then(async () => {
      const input = this.input;
      if (!input || this.closing) throw new Error('BLE proxy is disconnected');
      for (const fragment of proxyFragments(proxy ? 2 : 0, data)) {
        await deadline(input.writeAsync(fragment, !input.properties.includes('write')), 3000, 'BLE write');
      }
    });
    this.writes = write.catch((error) => {
      console.error(`BLE write failed: ${(error as Error).message}`);
    });
    return write;
  }

  async send(destination: number, payload: Buffer): Promise<void> {
    if (!this.ready || this.iv === undefined) throw new Error('BLE proxy is not ready');
    const sequence = this.sequences.take();
    const access = Buffer.concat([Buffer.from([0x26]), payload]);
    await this.sendNetwork(
      destination,
      this.crypto.access(access, sequence, this.config.source, destination, this.iv),
      false,
      false,
      sequence
    );
  }

  async readState(address: number): Promise<FixtureState> {
    return this.readPacket(address, readStatePacket(), decodeState);
  }

  async readFan(address: number): Promise<FanState> {
    return this.readPacket(address, readFanPacket(), decodeFan);
  }
  async readProductInfo(address: number): Promise<ProductInfo> {
    return this.readPacket(address, packet(0), decodeProductInfo);
  }
  async discoverUnprovisioned(): Promise<UnprovisionedDevice[]> {
    return discoverUnprovisioned();
  }

  async readPacket<T>(address: number, query: Buffer, decode: (payload: Buffer) => T | undefined): Promise<T> {
    let state: T | undefined;
    const response = this.wait<AccessMessage>(
      'access',
      (message) => {
        if (message.deviceKey) return false;
        if (message.source !== address) return false;
        // The command response is authenticated by the application key before reaching this point.
        if (message.data[0] !== 0x26 && message.data[0] !== 0x27) return false;
        state = decode(message.data.subarray(1));
        return state !== undefined;
      },
      3500
    );
    await Promise.all([response, this.send(address, query)]);
    if (state === undefined) throw new Error('No decodable fixture state');
    return state;
  }

  async configuration(address: number, request: Buffer, accept: (data: Buffer) => boolean): Promise<Buffer> {
    if (!this.ready) await this.connect();
    if (!this.ready || this.iv === undefined) throw new Error('BLE proxy is not ready');
    const key = this.config.lights.find((light) => light.address === address)?.deviceKey;
    if (!key) throw new Error('Device Key is unavailable; import matching Desktop keys first');
    const sequence = this.sequences.take();
    const payload = this.crypto.deviceAccess(key, request, sequence, this.config.source, address, this.iv);
    const response = this.wait<AccessMessage>(
      'access',
      (message) => {
        if (message.deviceKey !== true || message.source !== address) return false;
        if (this.debug && message.data[0] === 0x80 && [0x1f, 0x2a, 0x2c].includes(message.data[1]))
          console.error(`Configuration status ${address}: ${message.data.toString('hex')}`);
        return accept(message.data);
      },
      5000
    );
    const [result] = await Promise.all([response, this.sendNetwork(address, payload, false, false, sequence)]);
    return result.data;
  }

  private readonly notify = (fragment: Buffer): void => {
    try {
      const pdu = this.assembler.push(fragment);
      if (!pdu) return;
      if (pdu.type === 1) {
        this.iv = this.crypto.readBeacon(pdu.data);
        this.events.emit('beacon', this.iv);
        return;
      }
      if ((pdu.type !== 0 && pdu.type !== 2) || this.iv === undefined) return;
      const message = this.crypto.readNetwork(pdu.data, this.iv, pdu.type === 2);
      if (pdu.type === 2) {
        this.events.emit('filter', message.transport);
        return;
      }
      if (this.debug)
        console.error(
          `Mesh network RX source=${message.source} destination=${message.destination} control=${message.control} transport=${message.transport.toString('hex')}`
        );
      if (message.control || ![this.config.source, 1].includes(message.destination)) return;
      if (!this.config.lights.some((light) => light.address === message.source)) return;
      const lower = message.transport;
      const deviceKey = !(lower[0] & 0x40);
      const key = deviceKey
        ? this.config.lights.find((light) => light.address === message.source)?.deviceKey
        : undefined;
      if (deviceKey ? (lower[0] & 63) !== 0 || !key : (lower[0] & 127) !== (0x40 | this.crypto.aid)) return;
      const decode = (data: Buffer, sequence = message.sequence, mic = false) =>
        key
          ? this.crypto.readDeviceAccess(key, data, message, sequence, mic)
          : this.crypto.readAccess(data, message, sequence, mic);
      if (!(lower[0] & 128)) {
        this.emitAccess(message, decode(lower.subarray(1)), message.sequence, deviceKey);
        return;
      }
      if (lower.length < 5) throw new Error('Truncated segmented transport');
      const zero = ((lower[1] & 127) << 6) | (lower[2] >> 2);
      const index = ((lower[2] & 3) << 3) | (lower[3] >> 5);
      const count = (lower[3] & 31) + 1;
      const segmentKey = `${message.source}:${message.iv}:${zero}:${deviceKey ? 'device' : 'app'}`;
      for (const [id, entry] of this.segments) if (Date.now() - entry.started > 10_000) this.segments.delete(id);
      let segments = this.segments.get(segmentKey);
      if (!segments) {
        let sequence = (message.sequence & ~8191) | zero;
        if (sequence > message.sequence) sequence -= 8192;
        segments = { chunks: new Map(), count, sequence, mic: Boolean(lower[1] & 128), started: Date.now() };
        this.segments.set(segmentKey, segments);
      }
      if (index >= count || count !== segments.count) throw new Error('Inconsistent segmented transport');
      segments.chunks.set(index, lower.subarray(4));
      if (segments.chunks.size !== count) return;
      const encrypted = Buffer.concat(
        Array.from({ length: count }, (_, i) => segments.chunks.get(i) ?? Buffer.alloc(0))
      );
      const decoded = decode(encrypted, segments.sequence, segments.mic);
      const ack = Buffer.alloc(7);
      ack.writeUInt16BE(zero << 2, 1);
      ack.writeUInt32BE(count === 32 ? 0xffffffff : 2 ** count - 1, 3);
      void this.sendNetwork(message.source, ack, true).catch((error) =>
        console.error(`Segment acknowledgement failed: ${(error as Error).message}`)
      );
      this.segments.delete(segmentKey);
      this.emitAccess(message, decoded, segments.sequence, deviceKey);
    } catch (error) {
      console.error(`Rejected BLE notification: ${(error as Error).message}`);
    }
  };

  private emitAccess(message: NetworkMessage, data: Buffer, sequence: number, deviceKey = false): void {
    const last = this.received.get(message.source);
    if (last && (message.iv < last.iv || (message.iv === last.iv && sequence <= last.sequence))) return;
    this.received.set(message.source, { iv: message.iv, sequence });
    if (this.debug && !deviceKey)
      console.error(`Mesh RX source=${message.source} sequence=${sequence} access=${data.toString('hex')}`);
    this.events.emit('access', { source: message.source, sequence, data, deviceKey } satisfies AccessMessage);
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    this.initialized = false;
    this.events.emit('lost');
    this.output?.removeListener('data', this.notify);
    const peripheral = this.peripheral;
    this.input = undefined;
    this.output = undefined;
    if (peripheral && peripheral.state !== 'disconnected') {
      try {
        await deadline(peripheral.disconnectAsync(), 3000, 'BLE disconnect');
      } catch (error) {
        console.error((error as Error).message);
        peripheral.cancelConnect();
      }
    }
    this.peripheral = undefined;
    this.segments.clear();
  }
}
