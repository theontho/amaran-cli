import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SavedStateSchema } from '../src/ble/library.js';
import { FAN_MODES } from '../src/ble/telink.js';
import { captureWebcam } from './webcam.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const run = Date.now();
const records: unknown[] = [];
const failures: string[] = [];
const cleanup: string[] = [];
let baseline: { id: string; states: Record<string, z.infer<typeof SavedStateSchema>> } | undefined;
let group: string | undefined;
let priorOverrides: Record<string, number> = {};

async function request(route: string, body?: object, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { connection: 'close', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const data = z
    .object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || !data.ok) throw new Error(`${route}: ${data.error ?? response.status}`);
  records.push({ route, body, result: data.result });
  return data.result;
}
function cli(...args: string[]) {
  const output = execFileSync(process.execPath, ['dist/cli.js', ...args, '--backend', 'ble', '--url', base], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  records.push({ cli: args, output });
  return output;
}
async function state(key: string) {
  return SavedStateSchema.parse(await request(`/lights/${key}/state`));
}
const entry = z.object({ id: z.string() });
function image(label: string) {
  const filename = captureWebcam(`followup-${run}-${label}`);
  const report = z
    .object({
      regions: z.array(
        z.object({ name: z.string(), clippedFraction: z.number(), haloRgb: z.array(z.number()).optional() })
      ),
    })
    .parse(JSON.parse(readFileSync(filename.replace(/\.png$/, '.json'), 'utf8')));
  records.push({ camera: filename, regions: report.regions });
  return report.regions;
}

try {
  const remaining = z.record(z.number()).parse(await request('/overrides', { targets: 'all' }));
  priorOverrides = Object.fromEntries(Object.entries(remaining).map(([key, ms]) => [key, ms ? Date.now() + ms : 0]));
  for (const key of ['desk', 'front', 'back']) {
    const before = await state(key);
    assert.equal(before.mode, 'cct', 'Start these checks in steady CCT mode');
    assert.ok(!before.sleep && before.intensity >= 10 && before.intensity <= 50, 'Begin with all fixtures on at 1-5%');
  }
  const regions = image('baseline');
  for (const key of ['desk', 'front', 'back']) {
    const region = regions.find((item) => item.name === key);
    assert.ok(
      region && region.clippedFraction > 0.25,
      `${key}: camera region is not on the emitter; recalibrate before testing`
    );
  }
  baseline = z
    .object({ id: z.string(), states: z.record(SavedStateSchema) })
    .parse(await request('/library/scenes', { name: `Followup baseline ${run}` }));
  for (const key of Object.keys(baseline.states)) {
    const info = z
      .object({ cctMin: z.number(), cctMax: z.number(), protocolVersion: z.number() })
      .parse(await request(`/lights/${key}/info`));
    assert.equal(info.cctMin, key === 'back' ? 2500 : 2700);
  }
  group = entry.parse(await request('/groups', { name: `Followup ${run}` })).id;
  for (const member of ['desk', 'back']) await request(`/groups/${encodeURIComponent(group)}/members`, { member });
  cli('group', 'rename', group, `Followup renamed ${run}`);
  assert.equal(
    z.object({ name: z.string() }).parse(await request(`/groups/${encodeURIComponent(group)}`)).name,
    `Followup renamed ${run}`
  );
  cli('ble', 'transition', 'cct', '2', '--targets', 'all', '--args', '{"kelvin":3200,"brightness":1}');
  for (const key of ['desk', 'front', 'back']) assert.equal((await state(key)).cct, 3200);
  cli('ble', 'transition', 'hsi', '2', '--targets', 'back', '--args', '{"hue":120,"saturation":100,"brightness":1}');
  const green = image('green').find((region) => region.name === 'back')?.haloRgb;
  assert.ok(green && green[1] - Math.max(green[0], green[2]) > 20);
  assert.deepEqual(await request('/lights/back/auto-cct', { kelvin: 5600, brightness: 1 }), {
    skipped: true,
    reason: 'manual-override',
  });
  assert.equal((await state('back')).mode, 'hsi');
  for (const key of ['desk', 'back'])
    await request(`/lights/${key}/effect`, { name: 'pulsing', brightness: 0, frequency: 1 });
  const triggered = z
    .object({ triggerRequest: z.object({ sent: z.literal(true), eventConfirmed: z.literal(false) }) })
    .parse(await request(`/lights/${encodeURIComponent(group)}/effect-trigger`, {}));
  assert.equal(triggered.triggerRequest.eventConfirmed, false);
  cli('effect', 'stop', group);
  assert.equal((await state('desk')).mode, 'cct');
  assert.equal((await state('back')).mode, 'hsi');
  const preset = entry.parse(await request('/library/presets', { name: `Preset ${run}`, keys: ['back'] }));
  cleanup.push(`/library/presets/${preset.id}`);
  cli('preset', 'update', preset.id, '--name', `Preset updated ${run}`);
  assert.equal(
    z.object({ name: z.string() }).parse(await request(`/library/presets/${preset.id}`)).name,
    `Preset updated ${run}`
  );
  const quickshot = entry.parse(await request('/library/quickshots', { name: `Quickshot ${run}` }));
  cleanup.push(`/library/quickshots/${quickshot.id}`);
  cli('quickshot', 'update', quickshot.id, '--name', `Quickshot updated ${run}`);
  await request('/lights/back/fan', { mode: 'medium' });
  cli('scene', 'recall', baseline.id, '--fade', '2');
  for (const [key, expected] of Object.entries(baseline.states)) {
    const actual = await state(key);
    for (const field of ['mode', 'cct', 'intensity', 'sleep'] as const) assert.equal(actual[field], expected[field]);
    if (expected.fan)
      assert.equal(
        z.object({ mode: z.number() }).parse(await request(`/lights/${key}/fan`)).mode,
        FAN_MODES[expected.fan.mode]
      );
  }
} catch (error) {
  failures.push(String(error));
} finally {
  if (baseline) {
    try {
      await request(`/library/scenes/${baseline.id}/recall`, {});
    } catch (error) {
      failures.push(`Restore baseline: ${error}`);
    }
    cleanup.push(`/library/scenes/${baseline.id}`);
  }
  if (group) cleanup.push(`/groups/${encodeURIComponent(group)}`);
  for (const route of cleanup) {
    try {
      await request(route, undefined, 'DELETE');
    } catch (error) {
      failures.push(`Cleanup ${route}: ${error}`);
    }
  }
  if (!failures.length)
    for (const [key, expires] of Object.entries(priorOverrides)) {
      try {
        await request('/overrides', { targets: [key], minutes: Math.max(0, (expires - Date.now()) / 60_000) });
      } catch (error) {
        failures.push(`Restore override ${key}: ${error}`);
      }
    }
  writeFileSync(
    `artifacts/followup-${run}-results.json`,
    JSON.stringify({ baseline, priorOverrides, records, failures }, null, 2),
    { mode: 0o600 }
  );
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  `Supported-control checks passed; lighting, fan profiles and overrides restored. artifacts/followup-${run}-results.json`
);
