import { describe, expect, it, vi } from 'vitest';
import { changeSubscription, composition, subscriptions } from '../ble/configuration.js';
import { VerifiedController } from '../ble/controller.js';
import { MeshCrypto } from '../ble/crypto.js';
import { createBleServer } from '../ble/server.js';

const net = '7dd7364cd842ad18c17c2b820c84c3d6';
const app = '63964771734fbd76e3b40519d1d94a48';
const device = '2b7e151628aed2a6abf7158809cf4f3c';

describe('Device Key configuration', () => {
  it('uses Device nonces independently of application encryption', () => {
    const crypto = new MeshCrypto(net, app);
    const data = Buffer.from('800800', 'hex');
    const lower = crypto.deviceAccess(device, data, 128, 32766, 6, 0);
    const message = { source: 32766, destination: 6, sequence: 128, iv: 0, control: false, transport: lower };
    expect(lower[0]).toBe(0);
    expect(crypto.readDeviceAccess(device, lower.subarray(1), message)).toEqual(data);
    expect(() => crypto.readAccess(lower.subarray(1), message)).toThrow();
    expect(() => crypto.readDeviceAccess(app, lower.subarray(1), message)).toThrow();
    expect(() => crypto.deviceAccess(device, Buffer.alloc(12), 129, 32766, 6, 0)).toThrow('segmented');
  });
  it('decodes Desktop-captured composition without trusting truncated elements', () => {
    const raw = Buffer.from('020011020102333369000A0000000A01000002000300001002100410061007100013011311020000', 'hex');
    const result = composition(raw, 6);
    expect(result.company).toBe(0x0211);
    expect(result.models).toHaveLength(11);
    expect(result.models.at(-1)).toEqual({ element: 6, company: 0x0211, model: 0 });
    expect(() => composition(raw.subarray(0, -1), 6)).toThrow('Truncated');
  });
  it('encodes vendor group requests and verifies status plus subscription readback', async () => {
    const model = { element: 6, company: 0x0211, model: 0 };
    const configuration = vi.fn(async (_address: number, data: Buffer, accept: (response: Buffer) => boolean) => {
      const response =
        data[1] === 0x1b ? Buffer.from('801f00060000c111020000', 'hex') : Buffer.from('802c0006001102000000c1', 'hex');
      expect(accept(response)).toBe(true);
      return response;
    });
    await changeSubscription({ configuration }, 6, model, 0xc100, false);
    expect(configuration.mock.calls[0][1].toString('hex')).toBe('801b060000c111020000');
    expect(configuration.mock.calls[1][1].toString('hex')).toBe('802b060011020000');
    await expect(subscriptions({ configuration }, 6, model)).resolves.toEqual([0xc100]);
    await expect(changeSubscription({ configuration }, 6, model, 0xffff, false)).rejects.toThrow('Group address');
  });
  it('never exposes Device Keys through the HTTP metadata', async () => {
    const config = {
      netKey: net,
      appKey: app,
      source: 32766,
      lights: [{ key: 'test', name: 'Test', mac: '', address: 6, model: '200x-s' as const, deviceKey: device }],
    };
    const link = {
      ready: true,
      connect: async () => undefined,
      disconnect: async () => undefined,
      send: async () => undefined,
      readState: async () => ({
        mode: 'cct' as const,
        sleep: false,
        intensity: 10,
        cct: 3200,
        observedAt: new Date().toISOString(),
      }),
    };
    const server = createBleServer(new VerifiedController(config, link));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test address');
    try {
      const response = await (await fetch(`http://127.0.0.1:${address.port}/health`)).text();
      expect(response).not.toContain(device);
      expect(response).not.toContain('deviceKey');
      expect(JSON.parse(response).lights[0].key).toBe('test');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
