import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SavedStateSchema } from '../src/ble/library.js';
import { FAN_MODES, type FixtureState, parseFanMode } from '../src/ble/telink.js';
import { captureWebcam, imagePixels, RegionSchema, regionsFile } from './webcam.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const run = Date.now();
const results: unknown[] = [];
const errors: string[] = [];
const initial: Record<string, FixtureState> = {};
const fans: Record<string, number> = {};
const calibration = z.object({ regions: z.array(RegionSchema) }).parse(JSON.parse(readFileSync(regionsFile, 'utf8')));
const keys = ['desk', 'front', 'back'];
let changed = false;

async function request(route: string, body?: object, method = body ? 'POST' : 'GET'): Promise<unknown> {
  const response = await fetch(`${base}${route}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const data = z
    .object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || !data.ok) throw new Error(`${route}: ${data.error ?? response.status}`);
  results.push({ route, body, result: data.result });
  return data.result;
}
async function light(key: string, action: string, body?: object) {
  return SavedStateSchema.parse(await request(`/lights/${key}/${action}`, body));
}
function image(label: string) {
  const filename = captureWebcam(`extended-${run}-${label}`);
  return z
    .object({
      regions: z.array(
        z.object({ name: z.string(), rgb: z.array(z.number()), haloRgb: z.array(z.number()).optional() })
      ),
    })
    .parse(JSON.parse(readFileSync(filename.replace(/\.png$/, '.json'), 'utf8'))).regions;
}
function mean(rgb: number[]) {
  return rgb.reduce((sum, value) => sum + value, 0) / rgb.length;
}
function pulsingVideo(key: string) {
  const region = calibration.regions.find((entry) => entry.name === key);
  if (!region) throw new Error(`No calibrated region for ${key}`);
  const prefix = `extended-${run}-pulsing`;
  const capture = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-pixel_format',
      'nv12',
      '-framerate',
      '30',
      '-video_size',
      '1280x720',
      '-i',
      `${process.env.AMARAN_CAMERA_INDEX ?? '0'}:none`,
      '-t',
      '12',
      '-vf',
      'fps=2',
      '-y',
      `artifacts/webcam/${prefix}-%03d.png`,
    ],
    { encoding: 'utf8', timeout: 30_000 }
  );
  if (capture.status !== 0) throw new Error(capture.stderr || 'Pulsing video capture failed');
  const levels = readdirSync('artifacts/webcam')
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.png'))
    .sort()
    .map((name) => {
      const pixels = imagePixels(`artifacts/webcam/${name}`);
      let sum = 0;
      for (let y = region.y; y < region.y + region.height; y++)
        for (let x = region.x; x < region.x + region.width; x++) {
          const offset = (y * 1280 + x) * 3;
          sum += mean([...pixels.subarray(offset, offset + 3)]);
        }
      return sum / (region.width * region.height);
    });
  assert.ok(levels.length >= 20, 'Need enough camera samples to observe pulsing');
  const settled = levels.slice(6);
  assert.ok(Math.max(...settled) - Math.min(...settled) > 40, `Camera did not confirm pulse modulation: ${levels}`);
  const changes = settled.slice(1).map((value, index) => value - settled[index]);
  assert.ok(
    changes.some((value) => value > 20) && changes.some((value) => value < -20),
    'Need both rising and falling output after camera exposure settles'
  );
  results.push({ opticalPulsing: { key, levels, span: Math.max(...settled) - Math.min(...settled) } });
}

try {
  for (const key of keys) {
    initial[key] = await light(key, 'state');
    const fan = z.object({ mode: z.number() }).parse(await request(`/lights/${key}/fan`));
    parseFanMode(fan.mode);
    assert.notEqual(fan.mode, FAN_MODES.manual, 'Cannot infer an original manual RPM setpoint for restoration');
    fans[key] = fan.mode;
  }
  writeFileSync(`artifacts/extended-${run}-initial.json`, JSON.stringify({ states: initial, fans }, null, 2), {
    mode: 0o600,
  });
  assert.ok(
    Object.values(initial).every((state) => state.mode === 'cct'),
    'Begin hardware checks with all three fixtures in steady CCT mode'
  );
  changed = true;
  await request('/batch', { targets: 'all', action: 'off', args: {} });
  const dark = image('all-off');
  await request('/batch', { targets: 'all', action: 'cct', args: { kelvin: 3200, brightness: 1 } });
  const bright = image('all-1pct');
  for (const key of keys) {
    const before = dark.find((region) => region.name === key);
    const after = bright.find((region) => region.name === key);
    assert.ok(before && after);
    assert.ok(mean(after.rgb) - mean(before.rgb) > 40, `Camera did not confirm ${key} illumination`);
    const fan = z
      .object({ mode: z.number(), speed: z.number(), highTemperature: z.boolean() })
      .parse(await request(`/lights/${key}/fan`, { mode: 'medium' }));
    assert.equal(fan.mode, 5);
    assert.equal(fan.highTemperature, false);
    await request(`/lights/${key}/fan`, { mode: fans[key] });
  }
  for (const gm of [-30, 30, 0]) {
    assert.equal((await light('back', 'gm', { value: gm })).gm, gm);
    image(`gm-${gm}`);
  }
  await request('/batch', { targets: 'all', action: 'brightness', args: { value: 2 }, broadcast: true });
  for (const key of keys) assert.equal((await light(key, 'state')).intensity, 20);
  image('broadcast-2pct');
  await request('/fade', { targets: 'all', brightness: 1, seconds: 2 });
  for (const key of keys) assert.equal((await light(key, 'state')).intensity, 10);
  image('faded-1pct');
  const scene = z.object({ id: z.string() }).parse(await request('/library/scenes', { name: `Hardware check ${run}` }));
  try {
    await light('back', 'color', { color: '#00ff00', brightness: 1 });
    const colored = image('hsi-green').find((region) => region.name === 'back');
    assert.ok(
      colored?.haloRgb && colored.haloRgb[1] - Math.max(colored.haloRgb[0], colored.haloRgb[2]) > 20,
      'Camera did not confirm green HSI'
    );
    await request(`/library/scenes/${scene.id}/recall`, {});
    for (const key of keys) assert.equal((await light(key, 'state')).cct, 3200);
  } finally {
    await request(`/library/scenes/${scene.id}`, undefined, 'DELETE');
  }
  await light('front', 'off', {});
  await light('back', 'off', {});
  const pulse = await light('desk', 'effect', { name: 'pulsing', brightness: 1, frequency: 1, kelvin: 3200 });
  assert.equal(pulse.effect, 'pulsing');
  pulsingVideo('desk');
  await light('desk', 'effect-stop', {});
  await light('desk', 'off', {});
  for (const settings of [
    { name: 'pulsing', brightness: 1, frequency: 1, hue: 120, saturation: 100 },
    { name: 'party-lights', brightness: 1, frequency: 1, saturation: 80 },
  ]) {
    const state = await light('back', 'effect', settings);
    assert.equal(state.effect, settings.name);
    image(settings.name);
    await light('back', 'effect-intensity', { value: 2 });
    await light('back', 'effect-stop', {});
  }
} catch (error) {
  errors.push(String(error));
} finally {
  for (const [key, state] of changed ? Object.entries(initial) : []) {
    try {
      assert.equal(state.mode, 'cct', 'This check restores an initial steady CCT setup');
      await light(key, 'cct', {
        kelvin: state.cct,
        brightness: state.intensity / 10,
        ...(key === 'back' ? { gm: state.gm } : {}),
      });
      await light(key, state.sleep ? 'off' : 'on', {});
      const restored = await light(key, 'state');
      for (const field of ['cct', 'intensity', 'sleep'] as const) assert.equal(restored[field], state[field]);
      if (key === 'back') assert.equal(restored.gm, state.gm);
    } catch (error) {
      errors.push(`Restore ${key}: ${error}`);
    }
    if (fans[key] !== undefined) {
      try {
        await request(`/lights/${key}/fan`, { mode: fans[key] });
      } catch (error) {
        errors.push(`Restore ${key} fan: ${error}`);
      }
    }
  }
  writeFileSync(`artifacts/extended-${run}-results.json`, JSON.stringify({ results, errors }, null, 2), {
    mode: 0o600,
  });
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Extended live checks passed; results saved to artifacts/extended-${run}-results.json`);
