import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { captureWebcam } from './webcam.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const run = Date.now();
const results: object[] = [];
const positions: Record<string, string> = { desk: 'desk', front: 'front', back: 'back' };

async function request(key: string, action: string, body?: object) {
  const response = await fetch(`${base}/lights/${encodeURIComponent(key)}/${action}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`${key} ${action}: ${data.error ?? response.status}`);
  return data.result;
}

function image(label: string, key: string) {
  const filename = captureWebcam(`ble-check-${run}-${label}`);
  const metrics = JSON.parse(readFileSync(filename.replace(/\.png$/, '.json'), 'utf8'));
  const region = metrics.regions.find((entry: { name: string }) => entry.name === positions[key]);
  if (!region) throw new Error(`No camera ROI for ${key}`);
  return {
    filename,
    rgb: region.rgb as number[],
    haloRgb: region.haloRgb as number[] | undefined,
    clippedFraction: region.clippedFraction as number,
  };
}

const initial: Record<string, unknown> = {};
const errors: unknown[] = [];
try {
  for (const key of Object.keys(positions)) initial[key] = await request(key, 'state');
  writeFileSync(`artifacts/ble-check-${run}-initial.json`, JSON.stringify(initial, null, 2), { mode: 0o600 });
  for (const key of Object.keys(positions)) await request(key, 'off', {});
  for (const key of Object.keys(positions)) {
    const dark = image(`${key}-off`, key);
    await request(key, 'cct', { kelvin: 3200, brightness: 1 });
    await request(key, 'on', {});
    for (const kelvin of [3200, 6500]) {
      const state = await request(key, 'cct', { kelvin, brightness: 1 });
      await delay(500);
      const optical = image(`${key}-${kelvin}-1pct`, key);
      const difference = optical.rgb.reduce((sum, value, i) => sum + value - dark.rgb[i], 0) / 3;
      if (difference < 40) throw new Error(`${key}: camera did not confirm illumination (difference ${difference})`);
      results.push({ key, action: 'cct', requested: kelvin, state, optical, opticalOnDifference: difference });
    }
    for (const value of [0, 1, 2]) {
      const state = await request(key, 'brightness', { value });
      results.push({
        key,
        action: 'brightness',
        requested: value,
        state,
        optical: image(`${key}-${value}pct`, key),
      });
    }
    const state = await request(key, 'off', {});
    results.push({ key, action: 'off', state, optical: image(`${key}-off-after`, key) });
  }
  await request('back', 'on', {});
  for (const [hue, channel] of [
    [0, 0],
    [120, 1],
    [240, 2],
  ]) {
    const state = await request('back', 'hsi', { hue, saturation: 100, brightness: 1 });
    await delay(500);
    const optical = image(`back-hue-${hue}`, 'back');
    const color = optical.haloRgb;
    if (!color || color[channel] - Math.max(...color.filter((_, i) => i !== channel)) < 20)
      throw new Error(`Camera did not confirm hue ${hue}: halo RGB ${color}`);
    results.push({ key: 'back', action: 'hsi', requested: hue, state, optical });
  }
} catch (error) {
  errors.push(error);
} finally {
  const failures: string[] = [];
  for (const key of Object.keys(positions)) {
    try {
      await request(key, 'off', {});
    } catch (error) {
      failures.push(`${key}: ${(error as Error).message}`);
    }
  }
  writeFileSync(
    `artifacts/ble-check-${run}-results.json`,
    JSON.stringify({ results, errors: errors.map(String), shutdownFailures: failures }, null, 2),
    { mode: 0o600 }
  );
  if (failures.length) errors.push(new Error(`Could not confirm lights off: ${failures.join('; ')}`));
}
if (errors.length) throw new AggregateError(errors, 'Hardware verification failed');
console.log(`Hardware feedback checks completed: ${results.length} verified states with local images.`);
