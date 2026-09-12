import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SavedStateSchema } from '../src/ble/library.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const database = process.argv[2];
if (!database) throw new Error('Supply the matching Desktop database path');
const run = Date.now();
const records: unknown[] = [],
  failures: string[] = [];
const cleanup: string[] = [],
  jobs: string[] = [];
let baseline: { id: string; states: Record<string, z.infer<typeof SavedStateSchema>> } | undefined;
let overrides: Record<string, number> = {};
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
const Status = z.object({ id: z.string(), state: z.string(), frames: z.number(), error: z.string().optional() });
async function start(body: object) {
  const status = Status.parse(await request('/programs', body));
  jobs.push(status.id);
  return status;
}
async function wait(id: string, condition: (state: z.infer<typeof Status>) => boolean) {
  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    const status = Status.parse(await request(`/programs/${id}`));
    if (status.state === 'failed') throw new Error(status.error);
    if (condition(status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for program');
}
async function state(key: string) {
  return SavedStateSchema.parse(await request(`/lights/${key}/state`));
}
try {
  overrides = Object.fromEntries(
    Object.entries(z.record(z.number()).parse(await request('/overrides', { targets: 'all' }))).map(([key, ms]) => [
      key,
      ms ? Date.now() + ms : 0,
    ])
  );
  for (const key of ['desk', 'front', 'back']) {
    const light = await state(key);
    assert.ok(!light.sleep && light.mode === 'cct' && light.intensity <= 50, 'Begin awake in CCT at 5% or less');
  }
  baseline = z
    .object({ id: z.string(), states: z.record(SavedStateSchema) })
    .parse(await request('/library/scenes', { name: `Non-OTA baseline ${run}` }));
  const group = z.object({ id: z.string() }).parse(await request('/groups', { name: `Native verification ${run}` }));
  cleanup.push(`/groups/${encodeURIComponent(group.id)}`);
  for (const member of ['desk', 'back']) await request(`/groups/${encodeURIComponent(group.id)}/members`, { member });
  await request(`/groups/${encodeURIComponent(group.id)}/native`, { action: 'enable' });
  const changed = z
    .object({ delivery: z.literal('native-group') })
    .parse(await request(`/lights/${encodeURIComponent(group.id)}/brightness`, { value: 1 }));
  assert.equal(changed.delivery, 'native-group');
  assert.equal((await state('desk')).intensity, 10);
  assert.equal((await state('back')).intensity, 10);
  assert.equal((await state('front')).intensity, baseline.states.front.intensity);
  await request(`/groups/${encodeURIComponent(group.id)}/members`, { member: 'front' });
  await request(`/groups/${encodeURIComponent(group.id)}/members`, { member: 'front', remove: true });
  await request(`/groups/${encodeURIComponent(group.id)}/native`, { action: 'disable' });
  await request(`/library/scenes/${baseline.id}/recall`, {});
  const preview = z
    .object({
      valid: z.boolean(),
      plan: z.object({
        groups: z.array(z.object({ id: z.string() })),
        entries: z.array(z.object({ collection: z.string(), entry: z.object({ id: z.string() }) })),
      }),
    })
    .parse(await request('/desktop/import', { database: realpathSync(database), prefix: `Import check ${run}` }));
  assert.equal(preview.valid, true);
  for (const item of preview.plan.groups) cleanup.push(`/groups/${encodeURIComponent(item.id)}`);
  for (const item of preview.plan.entries)
    cleanup.push(`/library/${item.collection}/${encodeURIComponent(item.entry.id)}`);
  await request('/desktop/import', { database: realpathSync(database), prefix: `Import check ${run}`, apply: true });
  const again = z
    .object({ changes: z.object({ created: z.number(), unchanged: z.number() }) })
    .parse(
      await request('/desktop/import', { database: realpathSync(database), prefix: `Import check ${run}`, apply: true })
    );
  assert.equal(again.changes.created, 0);
  assert.ok(again.changes.unchanged > 0);
  const timeline = await start({
    kind: 'timeline',
    targets: 'all',
    duration: 2,
    steps: [
      { at: 0, action: 'brightness', args: { value: 1 } },
      { at: 1, action: 'brightness', args: { value: 2 } },
    ],
  });
  await wait(timeline.id, (status) => status.state === 'completed');
  const takeover = await start({
    kind: 'timeline',
    targets: ['back'],
    duration: 5,
    steps: [
      { at: 0, action: 'brightness', args: { value: 1 } },
      { at: 4, action: 'brightness', args: { value: 2 } },
    ],
  });
  await wait(takeover.id, (status) => status.frames > 0);
  await request('/lights/back/brightness', { value: 3 });
  assert.equal(Status.parse(await request(`/programs/${takeover.id}`)).state, 'cancelled');
  assert.equal((await state('back')).intensity, 30);
  await request(`/library/scenes/${baseline.id}/recall`, {});
  const picker = await start({
    kind: 'picker',
    targets: ['back'],
    duration: 4,
    maxBrightness: 1,
    source: { kind: 'image-file', file: realpathSync('artifacts/program-test-green.png') },
  });
  await wait(picker.id, (status) => status.frames > 0);
  assert.equal((await state('back')).mode, 'hsi');
  assert.equal((await state('back')).hue, 120);
  await wait(picker.id, (status) => status.state === 'completed');
  const audio = await start({
    kind: 'audio',
    targets: 'all',
    duration: 3,
    maxBrightness: 2,
    source: { kind: 'audio-file', file: realpathSync('artifacts/program-test-tone.wav') },
  });
  const audioDone = await wait(audio.id, (status) => status.state === 'completed');
  assert.ok(audioDone.frames > 0);
  const file = `artifacts/timeline-check-${run}.json`;
  writeFileSync(file, JSON.stringify({ duration: 1, steps: [{ at: 0, action: 'brightness', args: { value: 1 } }] }), {
    mode: 0o600,
  });
  execFileSync(process.execPath, ['dist/cli.js', 'ble', 'program', file, '--targets', 'back'], {
    stdio: 'pipe',
    timeout: 20_000,
  });
} catch (error) {
  failures.push(String(error));
} finally {
  for (const id of jobs) {
    try {
      await request(`/programs/${id}`, undefined, 'DELETE');
    } catch (error) {
      failures.push(`Stop program ${id}: ${error}`);
    }
  }
  if (baseline) {
    try {
      await request(`/library/scenes/${baseline.id}/recall`, {});
      for (const [key, expected] of Object.entries(baseline.states)) {
        const actual = await state(key);
        for (const field of ['mode', 'intensity', 'sleep', 'cct'] as const)
          assert.equal(actual[field], expected[field]);
      }
    } catch (error) {
      failures.push(`Restore: ${error}`);
    }
    cleanup.push(`/library/scenes/${baseline.id}`);
  }
  for (const route of cleanup.reverse()) {
    try {
      await request(route, undefined, 'DELETE');
    } catch (error) {
      failures.push(`Cleanup ${route}: ${error}`);
    }
  }
  if (!failures.length)
    for (const [key, until] of Object.entries(overrides)) {
      try {
        await request('/overrides', { targets: [key], minutes: Math.max(0, (until - Date.now()) / 60_000) });
      } catch (error) {
        failures.push(`Restore override ${key}: ${error}`);
      }
    }
  writeFileSync(`artifacts/non-ota-check-${run}.json`, JSON.stringify({ records, failures }, null, 2), { mode: 0o600 });
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Non-OTA checks passed; original state restored: artifacts/non-ota-check-${run}.json`);
