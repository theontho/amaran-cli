import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { FanStateSchema, FanStatesSchema } from '../src/ble/fan.js';
import { SavedStateSchema } from '../src/ble/library.js';
import { FAN_MODES, parseFanMode } from '../src/ble/telink.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const run = Date.now();
const records: unknown[] = [];
const failures: string[] = [];
let original: z.infer<typeof FanStatesSchema> | undefined;
let group: string | undefined;
let changed = false;
const lights: Record<string, z.infer<typeof SavedStateSchema>> = {};

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
  const output = execFileSync(
    process.execPath,
    ['dist/cli.js', 'fan', ...args, '--backend', 'ble', '--url', base, '--json'],
    {
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
  const data = FanStatesSchema.parse(JSON.parse(output));
  records.push({ cli: args, result: data });
  return data;
}
async function checkLighting() {
  for (const [key, before] of Object.entries(lights)) {
    const after = SavedStateSchema.parse(await request(`/lights/${key}/state`));
    const { observedAt: _beforeTime, ...beforeSettings } = before;
    const { observedAt: _afterTime, ...afterSettings } = after;
    assert.deepEqual(afterSettings, beforeSettings, `${key}: fan control changed lighting`);
  }
}

try {
  original = FanStatesSchema.parse(await request('/fans'));
  const keys = Object.keys(original.states);
  for (const [key, state] of Object.entries(original.states)) {
    parseFanMode(state.mode);
    assert.notEqual(state.mode, FAN_MODES.manual, 'Cannot infer an original manual RPM setpoint for restoration');
    assert.equal(state.highTemperature, false);
    assert.ok(state.supported.smart && state.supported.medium);
    lights[key] = SavedStateSchema.parse(await request(`/lights/${key}/state`));
    assert.ok(
      lights[key].intensity <= 50,
      'Run fan checks at 5% brightness or less; do not stress-test thermal protection'
    );
  }
  changed = true;
  for (const state of Object.values(cli('mode', 'all', 'smart').states)) assert.equal(state.mode, 1);
  for (const key of keys) {
    const selected = cli('mode', key, 'medium').states[key];
    assert.equal(selected.mode, 5);
    assert.equal(selected.highTemperature, false);
    assert.equal(selected.rpmStatus, selected.speed === 0 ? 'zero-reported' : 'rotation-reported');
    assert.equal(FanStateSchema.parse(await request(`/lights/${key}/fan`)).mode, 5);
  }
  const savedGroup = z.object({ id: z.string() }).parse(await request('/groups', { name: `Fan verification ${run}` }));
  group = savedGroup.id;
  const members = [...new Set([keys[0], keys[keys.length - 1]])];
  for (const member of members) await request(`/groups/${encodeURIComponent(group)}/members`, { member });
  const grouped = cli('mode', group, 'smart');
  assert.deepEqual(Object.keys(grouped.states).sort(), [...members].sort());
  for (const state of Object.values(grouped.states)) assert.equal(state.mode, 1);
  const deduplicated = FanStatesSchema.parse(await request('/fans', { targets: [group, members[0]], mode: 'medium' }));
  assert.equal(Object.keys(deduplicated.states).length, members.length);
  assert.equal(Object.keys(cli('info', group).states).length, members.length);
  for (const mode of ['off', 'silent', 'low', 'manual']) {
    await assert.rejects(
      request('/fans', { targets: 'all', mode, ...(mode === 'manual' ? { rpm: 2200 } : {}) }),
      /does not advertise/
    );
  }
  await checkLighting();
  if (process.argv.includes('--restart-service')) {
    for (const action of ['stop', 'start'])
      execFileSync(process.execPath, ['dist/cli.js', 'ble', 'service', action], { stdio: 'inherit', timeout: 100_000 });
    for (const state of Object.values(cli('info').states))
      assert.equal(state.mode, 5, 'Fan profile was reset on daemon restart');
    await checkLighting();
  }
} catch (error) {
  failures.push(String(error));
} finally {
  if (changed && original)
    for (const [key, state] of Object.entries(original.states)) {
      try {
        const restored = FanStateSchema.parse(await request(`/lights/${key}/fan`, { mode: state.mode }));
        assert.equal(restored.mode, state.mode);
        assert.equal(restored.highTemperature, false);
      } catch (error) {
        failures.push(`Restore ${key}: ${error}`);
      }
    }
  if (group) {
    try {
      await request(`/groups/${encodeURIComponent(group)}`, undefined, 'DELETE');
    } catch (error) {
      failures.push(`Group cleanup: ${error}`);
    }
  }
  mkdirSync('artifacts/fan-safety', { recursive: true });
  writeFileSync(
    `artifacts/fan-safety/live-${run}.json`,
    JSON.stringify({ original, lights, records, failures }, null, 2),
    { mode: 0o600 }
  );
}
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Fan profiles, CLI groups/all, telemetry and restoration passed: artifacts/fan-safety/live-${run}.json`);
