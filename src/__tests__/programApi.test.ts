import { expect, it } from 'vitest';
import { VerifiedController } from '../ble/controller.js';
import { createBleServer } from '../ble/server.js';

it('routes numeric live samples independently from job status and validates them', async () => {
  const config = {
    netKey: '0'.repeat(32),
    appKey: '1'.repeat(32),
    source: 32766,
    lights: [{ key: 'back', name: 'Back', mac: '', address: 10, model: '150c' as const }],
  };
  const link = {
    ready: true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    send: async () => undefined,
    readState: async () => ({
      mode: 'cct' as const,
      cct: 3200,
      gm: 0,
      intensity: 0,
      sleep: false,
      observedAt: new Date().toISOString(),
    }),
    readFan: async () => ({
      mode: 1,
      speed: 0,
      temperature: 30,
      highTemperature: false,
      supported: {
        smart: true,
        medium: true,
        manual: false,
        off: false,
        silent: false,
        low: false,
        high: false,
        max: false,
      },
    }),
  };
  const server = createBleServer(new VerifiedController(config, link));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/programs`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'picker',
        targets: ['back'],
        duration: 2,
        restore: false,
        source: { kind: 'samples', media: 'image' },
      }),
    });
    const { result: job } = await response.json();
    const accepted = await fetch(`${base}/programs/${job.id}/sample`, { method: 'POST', body: '{"rgb":[0,0,0]}' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, result: { accepted: true } });
    const invalid = await fetch(`${base}/programs/${job.id}/sample`, { method: 'POST', body: '{"rms":0.5}' });
    expect(invalid.status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await (await fetch(`${base}/programs/${job.id}`)).json()).result.frames).toBe(1);
    await fetch(`${base}/programs/${job.id}`, { method: 'DELETE' });
  } finally {
    await server.stopPrograms();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
