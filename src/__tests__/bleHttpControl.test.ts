import http from 'node:http';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLightDevices } from '../commands/cmdUtils.js';
import registerAutoCct from '../commands/daylightSimulation/autoCct.js';
import BleHttpController, { trimTrailingSlashes } from '../deviceControl/bleHttpControl.js';
import type { CommandDeps } from '../deviceControl/types.js';

describe('BleHttpController', () => {
  let server: http.Server;
  let baseUrl: string;
  const requests: Array<{ method?: string; url?: string; body: unknown; authorization?: string }> = [];

  beforeEach(async () => {
    requests.length = 0;
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: req.method,
        url: req.url,
        body: rawBody ? JSON.parse(rawBody) : undefined,
        authorization: req.headers.authorization,
      });

      if (req.url === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            lights: [{ key: 'key', name: 'Key Light', mac: 'A4:C1:38:13:41:38', address: 2 }],
          })
        );
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: 'ok' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (typeof address !== 'object' || !address) {
      throw new Error('test server did not provide an address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('loads BLE daemon lights as CLI light devices', async () => {
    const controller = await BleHttpController.connect(baseUrl);

    expect(controller.getDevices()).toMatchObject([
      {
        node_id: 'key',
        id: 'key',
        device_name: 'Key Light',
        device_type: 'ble-light',
        backend: 'ble',
      },
    ]);
    expect(getLightDevices(controller.getDevices())).toHaveLength(1);
  });

  it('sends supported commands to the BLE HTTP API', async () => {
    const controller = await BleHttpController.connect(baseUrl, 'test-key');

    await controller.setCCTAndIntensityForAllLights(5600, 750);
    controller.setIntensity('key', 250);
    controller.turnLightOff('key');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests).toContainEqual({
      method: 'POST',
      url: '/lights/all/cct',
      body: { kelvin: 5600, brightness: 75 },
      authorization: 'Bearer test-key',
    });
    expect(requests).toContainEqual({
      method: 'POST',
      url: '/lights/key/brightness',
      body: { value: 25 },
      authorization: 'Bearer test-key',
    });
    expect(requests).toContainEqual({
      method: 'POST',
      url: '/lights/key/off',
      body: {},
      authorization: 'Bearer test-key',
    });
  });

  it('supports auto-cct updates through the BLE backend', async () => {
    const deps: CommandDeps = {
      createController: async (url) => BleHttpController.connect(url),
      findDevice: (controller, deviceQuery) => {
        return (
          controller.getDevices().find((device) => device.node_id === deviceQuery || device.id === deviceQuery) ?? null
        );
      },
      asyncCommand:
        <T extends unknown[]>(fn: (...args: T) => Promise<void>) =>
        (...args: T) =>
          fn(...args),
      loadConfig: () => ({}),
    };
    const program = new Command();
    program.exitOverride();
    registerAutoCct(program, deps);

    await program.parseAsync([
      'node',
      'test',
      'auto-cct',
      'key',
      '--backend',
      'ble',
      '--url',
      baseUrl,
      '--lat',
      '40.7128',
      '--lon',
      '-74.0060',
      '--time',
      '2025-06-21T12:00:00-04:00',
    ]);

    expect(requests).toContainEqual({
      method: 'POST',
      url: '/lights/key/cct',
      body: { kelvin: expect.any(Number), brightness: expect.any(Number) },
      authorization: undefined,
    });
  });
});

describe('trimTrailingSlashes', () => {
  it('removes trailing slashes without changing the rest of the URL', () => {
    expect(trimTrailingSlashes('http://localhost:2708/')).toBe('http://localhost:2708');
    expect(trimTrailingSlashes('http://localhost:2708///')).toBe('http://localhost:2708');
    expect(trimTrailingSlashes('http://localhost:2708')).toBe('http://localhost:2708');
    expect(trimTrailingSlashes('')).toBe('');
  });
});
