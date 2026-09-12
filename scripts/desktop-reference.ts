import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { captureWebcam } from './webcam.js';

const ws = new WebSocket(process.env.AMARAN_REFERENCE_WS ?? 'ws://127.0.0.1:12345');
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  const key = `${message.request?.type}:${message.request?.node_id ?? ''}`;
  const request = pending.get(key);
  if (!request) return;
  if (message.code !== 0) request.reject(new Error(message.message));
  else request.resolve(message.data?.data ?? message.data);
});

async function command(type: string, nodeId?: string, args?: Record<string, unknown>): Promise<unknown> {
  const key = `${type}:${nodeId ?? ''}`;
  if (pending.has(key)) throw new Error(`Concurrent duplicate command: ${key}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      pending.set(key, { resolve, reject });
      timer = setTimeout(() => reject(new Error(`Desktop response timeout: ${key}`)), 8000);
      ws.send(JSON.stringify({ version: 1, client_id: 'hardware-reference', type, node_id: nodeId, args }));
    });
  } finally {
    clearTimeout(timer);
    pending.delete(key);
  }
}

const fixtures = [
  { key: 'desk', nodeId: '400Q5-11B2F8' },
  { key: 'front', nodeId: '400Q5-119B16' },
  { key: 'back', nodeId: '400J5-F2C008' },
];

try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Desktop connection timeout')), 8000);
    ws.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  mkdirSync('artifacts', { recursive: true });
  const snapshot = [];
  for (const fixture of fixtures) {
    snapshot.push({
      ...fixture,
      sleep: await command('get_sleep', fixture.nodeId),
      intensity: await command('get_intensity', fixture.nodeId),
      cct: await command('get_cct', fixture.nodeId),
    });
  }
  writeFileSync(`artifacts/desktop-state-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(snapshot, null, 2));
  if (process.argv[2] === 'reference') {
    const stamp = Date.now();
    for (const fixture of fixtures) {
      await command('set_intensity', fixture.nodeId, { intensity: 10 });
      await command('set_sleep', fixture.nodeId, { sleep: true });
    }
    await delay(1000);
    console.log(captureWebcam(`desktop-${stamp}-all-off`));
    for (const fixture of fixtures) {
      await command('set_cct', fixture.nodeId, { cct: 3200, intensity: 10 });
      await command('set_sleep', fixture.nodeId, { sleep: false });
      await delay(1000);
      console.log(captureWebcam(`desktop-${stamp}-${fixture.key}-3200-1pct`));
      await command('set_cct', fixture.nodeId, { cct: 6500, intensity: 10 });
      await delay(1000);
      console.log(captureWebcam(`desktop-${stamp}-${fixture.key}-6500-1pct`));
      await command('set_sleep', fixture.nodeId, { sleep: true });
    }
    console.log('Reference complete. All fixtures left asleep at 1%; original state saved in artifacts.');
  }
} finally {
  ws.close();
}
