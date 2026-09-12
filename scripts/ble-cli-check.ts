import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { SavedStateSchema } from '../src/ble/library.js';

const base = process.env.AMARAN_BLE_URL ?? 'http://127.0.0.1:2708';
const Schema = z.object({
  prefix: z.string(),
  initial: z.record(SavedStateSchema),
  grouped: z.record(SavedStateSchema),
});
function cli(...args: string[]) {
  const separator = args.indexOf('--');
  const flags = ['--backend', 'ble', '--url', base];
  const command =
    separator < 0 ? [...args, ...flags] : [...args.slice(0, separator), ...flags, ...args.slice(separator)];
  return execFileSync(process.execPath, ['dist/cli.js', ...command], { encoding: 'utf8', timeout: 60_000 });
}
async function snapshot() {
  const states: z.infer<typeof Schema>['initial'] = {};
  for (const key of ['desk', 'front', 'back']) {
    const response = await fetch(`${base}/lights/${key}/state`, { signal: AbortSignal.timeout(15_000) });
    const data = z.object({ ok: z.literal(true), result: SavedStateSchema }).parse(await response.json());
    states[key] = data.result;
  }
  return states;
}
function equal(actual: z.infer<typeof Schema>['initial'], expected: z.infer<typeof Schema>['initial']) {
  for (const key of Object.keys(expected)) {
    for (const field of ['mode', 'cct', 'intensity', 'sleep'] as const)
      assert.equal(actual[key][field], expected[key][field]);
    if (key === 'back') assert.equal(actual[key].gm, expected[key].gm);
  }
}
const phase = process.argv[2];
if (phase === 'prepare') {
  const prefix = `CLI verification ${Date.now()}`;
  const initial = await snapshot();
  assert.ok(Object.values(initial).every((state) => state.mode === 'cct'));
  const filename = `artifacts/cli-check-${Date.now()}.json`;
  writeFileSync(filename, JSON.stringify({ prefix, initial, grouped: initial }, null, 2), { mode: 0o600 });
  const created: [string, string][] = [];
  try {
    cli('scene', 'save', `${prefix} scene`);
    created.push(['scene', `${prefix} scene`]);
    cli('preset', 'save', 'back', `${prefix} preset`);
    created.push(['preset', `${prefix} preset`]);
    cli('group', 'create', `${prefix} group`);
    created.push(['group', `${prefix} group`]);
    cli('group', 'add', `${prefix} group`, 'desk');
    cli('group', 'add', `${prefix} group`, 'front');
    cli('intensity', '1', `${prefix} group`);
    cli('intensity', '1', `${prefix} group`, '--relative');
    cli('cct', '100', `${prefix} group`, '--relative');
    const grouped = await snapshot();
    assert.equal(grouped.desk.intensity, 20);
    assert.equal(grouped.front.intensity, 20);
    assert.equal(grouped.back.intensity, initial.back.intensity);
    assert.equal(grouped.desk.cct, (initial.desk.cct ?? 0) + 100);
    const status = cli('status', `${prefix} group`);
    assert.ok(status.includes('Status for desk') && status.includes('Status for front') && !status.includes('Unknown'));
    cli('quickshot', 'save', `${prefix} quickshot`);
    created.push(['quickshot', `${prefix} quickshot`]);
    cli('ble', 'gm', 'back', '--', '-30');
    assert.equal((await snapshot()).back.gm, -30);
    writeFileSync(filename, JSON.stringify({ prefix, initial, grouped }, null, 2), { mode: 0o600 });
    console.log(`Prepared persistent CLI checks: ${filename}`);
  } catch (error) {
    const failures: unknown[] = [error];
    if (created.some(([kind]) => kind === 'scene')) {
      try {
        cli('scene', 'recall', `${prefix} scene`);
        equal(await snapshot(), initial);
      } catch (restoration) {
        failures.push(restoration);
      }
    }
    for (const [kind, name] of created.reverse()) {
      try {
        cli(kind, 'delete', name);
      } catch (cleanup) {
        failures.push(cleanup);
      }
    }
    throw new AggregateError(failures, `CLI preparation failed; recovery snapshot: ${filename}`);
  }
} else if (phase === 'verify' && process.argv[3]) {
  const filename = process.argv[3];
  const { prefix, initial, grouped } = Schema.parse(JSON.parse(readFileSync(filename, 'utf8')));
  const errors: unknown[] = [];
  try {
    assert.ok(cli('group', 'list').includes(`${prefix} group`));
    assert.ok(cli('preset', 'list').includes(`${prefix} preset`));
    assert.ok(cli('quickshot', 'list').includes(`${prefix} quickshot`));
    cli('preset', 'recall', 'back', `${prefix} preset`);
    assert.equal((await snapshot()).back.gm, initial.back.gm);
    cli('scene', 'recall', `${prefix} scene`);
    equal(await snapshot(), initial);
    cli('intensity', '1', 'all');
    cli('quickshot', 'set', `${prefix} quickshot`);
    equal(await snapshot(), grouped);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      cli('scene', 'recall', `${prefix} scene`);
      equal(await snapshot(), initial);
    } catch (error) {
      errors.push(error);
    }
    for (const [kind, name] of [
      ['preset', 'preset'],
      ['quickshot', 'quickshot'],
      ['group', 'group'],
      ['scene', 'scene'],
    ]) {
      try {
        cli(kind, 'delete', `${prefix} ${name}`);
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'CLI persistence checks or restoration failed');
  console.log(
    'CLI groups, tint, relative controls, presets, scenes and quickshots survived restart; initial lighting restored.'
  );
} else throw new Error('Use prepare, restart the daemon, then verify <manifest>');
