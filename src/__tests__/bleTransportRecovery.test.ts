import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import noble from '@abandonware/noble';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicJson, type MeshConfig, SequenceStore } from '../ble/storage.js';
import { initializeUserChannel, MeshTransport, proxyFragments } from '../ble/transport.js';

vi.mock('@abandonware/noble', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    default: Object.assign(new EventEmitter(), {
      _state: 'poweredOn',
      startScanningAsync: vi.fn(async () => undefined),
      stopScanningAsync: vi.fn(async () => undefined),
    }),
  };
});

vi.mock('node:timers/promises', () => ({
  setTimeout: (milliseconds: number, value?: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        const reason: unknown = options?.signal?.reason;
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      };
      const timer = setTimeout(() => {
        options?.signal?.removeEventListener('abort', abort);
        resolve(value);
      }, milliseconds);
      if (options?.signal?.aborted) abort();
      else options?.signal?.addEventListener('abort', abort, { once: true });
    }),
}));

// Public Bluetooth Mesh specification keys, not deployed credentials.
const config: MeshConfig = {
  netKey: '7dd7364cd842ad18c17c2b820c84c3d6',
  appKey: '63964771734fbd76e3b40519d1d94a48',
  source: 32766,
  lights: [{ key: 'desk', name: 'desk', address: 6, mac: '', model: '200x-s' }],
};

describe('mesh transport outage recovery', () => {
  let directory: string;
  let sequences: SequenceStore;
  let link: MeshTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    directory = mkdtempSync(path.join(tmpdir(), 'amaran-transport-'));
    atomicJson(path.join(directory, 'sequence.json'), {
      networkId: '3ecaff672f673370',
      source: config.source,
      next: 128,
    });
    sequences = new SequenceStore(directory, '3ecaff672f673370', config.source);
    link = new MeshTransport(config, sequences);
    vi.mocked(noble.startScanningAsync).mockImplementation(async () => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    sequences.close();
    rmSync(directory, { recursive: true, force: true });
    noble.removeAllListeners();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('initializes missing user-channel ACL buffers on the actual HCI instance and rejects incompatible bindings', () => {
    const hci = {
      initialized: false,
      readLeBufferSize: vi.fn(function (this: { initialized: boolean }) {
        this.initialized = true;
      }),
    };
    initializeUserChannel({ _hci: hci });
    expect(hci.initialized).toBe(true);
    expect(hci.readLeBufferSize).toHaveBeenCalledOnce();
    expect(() => initializeUserChannel({})).toThrow('HCI bindings');
    expect(() => initializeUserChannel({ _hci: {} })).toThrow('ACL buffers');
  });

  function proxy() {
    const output = Object.assign(new EventEmitter(), {
      uuid: '2ade',
      subscribeAsync: vi.fn(async () => {
        output.emit('data', Buffer.from([1, 0]));
      }),
    });
    vi.spyOn(link.crypto, 'readBeacon').mockReturnValue(0);
    let filters = 0;
    const input = {
      uuid: '2add',
      properties: ['write'],
      writeAsync: vi.fn(async (fragment: Buffer) => {
        if (fragment[0] >> 6 === 1 || fragment[0] >> 6 === 2) return;
        const packet = link.crypto.network(
          {
            source: 1,
            destination: 0,
            sequence: filters + 1,
            iv: 0,
            control: true,
            transport: Buffer.from([3, 0, 0, filters++ === 0 ? 0 : 2]),
          },
          true
        );
        for (const part of proxyFragments(2, packet)) output.emit('data', part);
      }),
    };
    const peripheral = Object.assign(new EventEmitter(), {
      id: 'proxy',
      rssi: -50,
      state: 'disconnected',
      advertisement: {
        serviceData: [{ uuid: '1828', data: Buffer.concat([Buffer.from([0]), link.crypto.networkId]) }],
      },
      connectAsync: vi.fn(async () => {
        peripheral.state = 'connected';
      }),
      disconnectAsync: vi.fn(async () => {
        peripheral.state = 'disconnected';
        peripheral.emit('disconnect');
      }),
      cancelConnect: vi.fn(),
      discoverSomeServicesAndCharacteristicsAsync: vi.fn(async () => ({ characteristics: [input, output] })),
    });
    vi.mocked(noble.startScanningAsync).mockImplementation(async () => {
      EventEmitter.prototype.emit.call(noble, 'discover', peripheral);
    });
    return { peripheral, input, output };
  }

  it('coalesces scans and stays offline without restart storms through prolonged and repeated power cuts', async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      vi.mocked(noble.startScanningAsync).mockImplementation(async () => undefined);
      const attempt = link.connect();
      expect(link.connect()).toBe(attempt);
      const rejected = expect(attempt).rejects.toThrow('No powered mesh proxy');
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(link.connectionStatus).toMatchObject({ state: 'offline', resetRequired: false });
      const scans = vi.mocked(noble.startScanningAsync).mock.calls.length;
      await expect(link.connect()).rejects.toThrow('No powered mesh proxy');
      expect(noble.startScanningAsync).toHaveBeenCalledTimes(scans);
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      const { output } = proxy();
      const restored = link.connect();
      await vi.advanceTimersByTimeAsync(5500);
      await restored;
      expect(link.ready).toBe(true);
      expect(link.connectionStatus).toMatchObject({ state: 'connected', nextRetryAt: 0, resetRequired: false });
      await link.disconnect();
      expect(output.listenerCount('data')).toBe(0);
    }
  });

  it('cancels timed-out connection attempts before trying another proxy', async () => {
    const { peripheral } = proxy();
    let rejectConnect: (error: Error) => void = () => {
      throw new Error('Connection not started');
    };
    peripheral.connectAsync.mockImplementation(() => {
      peripheral.state = 'connecting';
      return new Promise<void>((_resolve, reject) => {
        rejectConnect = reject;
      });
    });
    peripheral.cancelConnect.mockImplementation(() => {
      rejectConnect(new Error('connection cancelled'));
      peripheral.state = 'disconnected';
    });
    const rejected = expect(link.connect()).rejects.toThrow('BLE connect timed out');
    await vi.advanceTimersByTimeAsync(15_200);
    await rejected;
    expect(peripheral.cancelConnect).toHaveBeenCalledOnce();
    expect(peripheral.disconnectAsync).not.toHaveBeenCalled();
    expect(link.connectionStatus.resetRequired).toBe(false);
  });

  it('requests supervised recovery when a native disconnect never completes', async () => {
    const { peripheral } = proxy();
    const connected = link.connect();
    await vi.advanceTimersByTimeAsync(5500);
    await connected;
    peripheral.disconnectAsync.mockImplementation(() => new Promise<void>(() => undefined));
    const disconnected = link.disconnect();
    await vi.advanceTimersByTimeAsync(3000);
    await disconnected;
    expect(link.connectionStatus).toMatchObject({ state: 'recovering', resetRequired: true });
    await expect(link.connect()).rejects.toThrow('BLE disconnect timed out');
  });

  it('escalates repeated advertised-proxy native timeouts, but not missing advertisements, to supervised recovery', async () => {
    const { peripheral } = proxy();
    let rejectConnect: (error: Error) => void = () => {
      throw new Error('Connection not started');
    };
    peripheral.connectAsync.mockImplementation(() => {
      peripheral.state = 'connecting';
      return new Promise<void>((_resolve, reject) => {
        rejectConnect = reject;
      });
    });
    peripheral.cancelConnect.mockImplementation(() => {
      rejectConnect(new Error('connection cancelled'));
      peripheral.state = 'disconnected';
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.advanceTimersByTimeAsync(Math.max(0, link.connectionStatus.nextRetryAt - Date.now()));
      const rejected = expect(link.connect()).rejects.toThrow('BLE connect timed out');
      await vi.advanceTimersByTimeAsync(15_200);
      await rejected;
    }
    expect(link.connectionStatus).toMatchObject({ resetRequired: true, state: 'recovering' });
    const scans = vi.mocked(noble.startScanningAsync).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(link.connect()).rejects.toThrow('BLE connect timed out');
    expect(noble.startScanningAsync).toHaveBeenCalledTimes(scans);
  });

  it('does not let late callbacks or queued fragments from the old proxy affect a new connection', async () => {
    const old = proxy();
    const connected = link.connect();
    await vi.advanceTimersByTimeAsync(5500);
    await connected;
    old.peripheral.disconnectAsync.mockImplementation(async () => {
      old.peripheral.state = 'disconnected';
    });
    let finishWrite: () => void = () => {
      throw new Error('Write not started');
    };
    old.input.writeAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        })
    );
    const first = expect(link.send(6, Buffer.alloc(10))).rejects.toThrow();
    const queued = expect(link.send(6, Buffer.alloc(10))).rejects.toThrow('BLE proxy is disconnected');
    await vi.advanceTimersByTimeAsync(0);
    await link.disconnect();
    const fresh = proxy();
    fresh.peripheral.id = 'new-proxy';
    const restored = link.connect();
    await vi.advanceTimersByTimeAsync(5500);
    await restored;
    await first;
    await queued;
    finishWrite();
    old.peripheral.emit('disconnect');
    expect(link.ready).toBe(true);
    expect(fresh.input.writeAsync.mock.calls.every(([fragment]) => (fragment[0] & 63) === 2)).toBe(true);
  });
});
