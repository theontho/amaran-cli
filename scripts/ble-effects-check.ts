import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { COLOR_EFFECTS, WHITE_EFFECTS } from '../src/ble/effects.js';
import { SavedStateSchema } from '../src/ble/library.js';
import type { FixtureState } from '../src/ble/telink.js';
import { captureWebcam } from './webcam.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const run = Date.now();
const original: Record<string, FixtureState> = {};
const results: unknown[] = [];
const errors: string[] = [];
let changed = false;
async function request(key: string, action: string, body?: object) {
  const response = await fetch(`${base}/lights/${key}/${action}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const data = z
    .object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || !data.ok) throw new Error(`${key}/${action}: ${data.error ?? response.status}`);
  const state = SavedStateSchema.parse(data.result);
  results.push({ key, action, body, state });
  return state;
}
try {
  for (const key of ['desk', 'front', 'back']) original[key] = await request(key, 'state');
  assert.ok(
    Object.values(original).every((state) => state.mode === 'cct'),
    'Begin with a steady CCT setup'
  );
  changed = true;
  for (const key of Object.keys(original)) await request(key, 'cct', { kelvin: 3200, brightness: 0 });
  captureWebcam(`effects-${run}-dark-before`);
  for (const key of Object.keys(original)) {
    for (const name of key === 'back' ? COLOR_EFFECTS : WHITE_EFFECTS) {
      const state = await request(key, 'effect', { name, brightness: 0, frequency: 1 });
      assert.equal(state.effect, name);
      assert.equal(state.intensity, 0);
      assert.equal((await request(key, 'effect-speed', { value: 2 })).frequency, 2);
      assert.equal((await request(key, 'effect-intensity', { value: 0 })).intensity, 0);
      console.log(`${key}: ${name}, zero output, verified`);
    }
    if (key === 'back') {
      for (const name of ['faulty-bulb', 'pulsing']) {
        const state = await request(key, 'effect', { name, brightness: 0, frequency: 1, hue: 240, saturation: 80 });
        assert.equal(state.hue, 240);
        assert.equal(state.sat, 80);
        assert.equal(state.intensity, 0);
      }
    }
    await request(key, 'effect-stop', {});
  }
  captureWebcam(`effects-${run}-dark-after`);
} catch (error) {
  errors.push(String(error));
} finally {
  if (changed)
    for (const [key, state] of Object.entries(original)) {
      try {
        await request(key, 'cct', {
          kelvin: state.cct,
          brightness: state.intensity / 10,
          ...(key === 'back' ? { gm: state.gm } : {}),
        });
        await request(key, state.sleep ? 'off' : 'on', {});
        const restored = await request(key, 'state');
        for (const field of ['cct', 'sleep', 'intensity'] as const) assert.equal(restored[field], state[field]);
        if (key === 'back') assert.equal(restored.gm, state.gm);
      } catch (error) {
        errors.push(`Restore ${key}: ${error}`);
      }
    }
  writeFileSync(`artifacts/effects-${run}-results.json`, JSON.stringify({ original, results, errors }, null, 2), {
    mode: 0o600,
  });
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`All native effect settings verified at zero output; artifacts/effects-${run}-results.json`);
