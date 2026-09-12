import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshCrypto } from '../src/ble/crypto.js';
import { loadMeshConfig, meshDirectory, SequenceStore } from '../src/ble/storage.js';
import { cctPacket, powerPacket } from '../src/ble/telink.js';
import { MeshTransport } from '../src/ble/transport.js';
import { captureWebcam } from './webcam.js';

const config = loadMeshConfig();
const crypto = new MeshCrypto(config.netKey, config.appKey);
const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
const transport = new MeshTransport(config, sequence, true);
try {
  await transport.connect();
  const back = config.lights.find((light) => light.model === '150c');
  if (!back) throw new Error('150c fixture not found');
  const original = await transport.readState(back.address);
  if (process.argv[2] === 'gm') {
    try {
      for (const gm of [-30, 0, 30]) {
        await transport.send(back.address, cctPacket(3200, 10, gm));
        await delay(300);
        const state = await transport.readState(back.address);
        console.log('G/M applied', state);
        assert.equal(state.gm, gm);
        assert.equal(state.cct, 3200);
        assert.equal(state.intensity, 10);
        console.log(captureWebcam(`gm-${gm < 0 ? 'minus' : 'plus'}-${Math.abs(gm)}-${Date.now()}`));
      }
    } finally {
      await transport.send(back.address, cctPacket(original.cct ?? 3200, original.intensity, 0));
      await delay(300);
      await transport.send(back.address, powerPacket(!original.sleep));
      console.log('Restored with corrected neutral tint', await transport.readState(back.address));
    }
  } else {
    console.log(original);
    for (const light of config.lights) console.log(light.key, await transport.readFan(light.address));
  }
} finally {
  await transport.disconnect();
  sequence.close();
}
process.exit(0);
