import { writeFileSync } from 'node:fs';
import {
  changeSubscription,
  type MeshModel,
  modelBindings,
  readComposition,
  subscriptions,
} from '../src/ble/configuration.js';
import { MeshCrypto } from '../src/ble/crypto.js';
import { desktopDeviceKeys } from '../src/ble/desktop.js';
import { loadMeshConfig, meshDirectory, SequenceStore } from '../src/ble/storage.js';
import { brightnessPacket, type FixtureState } from '../src/ble/telink.js';
import { MeshTransport } from '../src/ble/transport.js';

if (!process.argv[2]) throw new Error('Supply the matching Desktop database path; this probe is read-only');
const config = desktopDeviceKeys(process.argv[2], loadMeshConfig());
const crypto = new MeshCrypto(config.netKey, config.appKey);
const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
const link = new MeshTransport(config, sequence, process.argv.includes('--debug'));
const results: unknown[] = [];
const capable: { key: string; address: number; model: MeshModel; groups: number[] }[] = [];
const added: typeof capable = [];
const original = new Map<number, FixtureState>();
let discoveryFailed = false;
try {
  await link.connect();
  for (const light of config.lights) {
    try {
      const data = await readComposition(link, light.address);
      console.log(light.key, data);
      const models = [];
      for (const model of data.models.filter((item) => item.company !== undefined || item.model >= 0x1000)) {
        const bindings = await modelBindings(link, light.address, model);
        if (!bindings.includes(0)) continue;
        const groups = await subscriptions(link, light.address, model);
        models.push({ model, groups, bindings });
        capable.push({ key: light.key, address: light.address, model, groups });
      }
      const phase = await link.configuration(
        light.address,
        Buffer.from([0x80, 0x15, 0, 0]),
        (data) => data.length === 6 && data[0] === 0x80 && data[1] === 0x17
      );
      console.log(light.key, 'subscriptions', models, 'key refresh status', phase.toString('hex'));
      results.push({
        key: light.key,
        composition: data,
        subscriptions: models,
        keyRefreshStatus: phase.toString('hex'),
      });
    } catch (error) {
      discoveryFailed = true;
      console.error(light.key, (error as Error).message);
      results.push({ key: light.key, error: (error as Error).message });
    }
  }
  if (process.argv.includes('--exercise')) {
    const group = 0xce01;
    if (discoveryFailed || !capable.length || capable.some((item) => item.groups.includes(group)))
      throw new Error('Incomplete discovery or test group already in use');
    for (const light of config.lights) {
      const state = await link.readState(light.address);
      if (state.intensity > 50) throw new Error('Use at most 5% output for this check');
      original.set(light.address, state);
    }
    for (const item of capable.filter(
      (item) => item.key !== 'front' && item.model.company === undefined && item.model.model === 0x1000
    )) {
      console.log('Adding temporary subscription', item.key, item.model);
      added.push(item);
      await changeSubscription(link, item.address, item.model, group, false);
    }
    await link.send(group, brightnessPacket(10));
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const light of config.lights) {
      const state = await link.readState(light.address);
      const expected = light.key === 'front' ? original.get(light.address)?.intensity : 10;
      if (state.intensity !== expected)
        throw new Error(`Native group did not match ${light.key}: ${state.intensity}, expected ${expected}`);
    }
    console.log('Native subset group controlled desk/back without changing front');
  }
} finally {
  const failures: string[] = [];
  for (const [address, state] of original) {
    try {
      await link.send(address, brightnessPacket(state.intensity));
      const restored = await link.readState(address);
      if (restored.intensity !== state.intensity) failures.push(`Could not restore brightness at ${address}`);
    } catch (error) {
      failures.push(`${address}: ${error}`);
    }
  }
  for (const item of added.reverse()) {
    try {
      await changeSubscription(link, item.address, item.model, 0xce01, true);
    } catch (error) {
      failures.push(`Remove test subscription ${item.address}: ${error}`);
    }
  }
  await link.disconnect();
  sequence.close();
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  }
  writeFileSync(`artifacts/config-probe-${Date.now()}.json`, JSON.stringify(results, null, 2), { mode: 0o600 });
}
process.exit(process.exitCode ?? 0);
