import { setTimeout as delay } from 'node:timers/promises';
import { MeshCrypto } from '../src/ble/crypto.js';
import { importMesh } from '../src/ble/setup.js';
import { loadMeshConfig, meshDirectory, SequenceStore } from '../src/ble/storage.js';
import { cctPacket, powerPacket } from '../src/ble/telink.js';
import { MeshTransport } from '../src/ble/transport.js';
import { captureWebcam } from './webcam.js';

if (process.argv[2] === 'import') {
  importMesh(process.argv[3]);
} else {
  const config = loadMeshConfig();
  const crypto = new MeshCrypto(config.netKey, config.appKey);
  const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
  const transport = new MeshTransport(config, sequence, true);
  try {
    await transport.connect();
    if (process.argv[2] === 'test-desk') {
      const light = config.lights.find((entry) => entry.key === 'desk');
      if (!light) throw new Error('Desk fixture not configured');
      try {
        await transport.send(light.address, cctPacket(3200, 10));
        await delay(300);
        await transport.send(light.address, powerPacket(true));
        await delay(300);
        console.log('ON state', await transport.readState(light.address));
        console.log(captureWebcam(`ble-desk-on-${Date.now()}`));
      } finally {
        await transport.send(light.address, powerPacket(false));
        await delay(300);
        console.log('OFF state', await transport.readState(light.address));
      }
      console.log(captureWebcam(`ble-desk-off-${Date.now()}`));
    } else {
      for (const light of config.lights) {
        console.log(light.name, await transport.readState(light.address));
        console.log('Fan', await transport.readFan(light.address));
      }
    }
  } finally {
    await transport.disconnect();
    sequence.close();
  }
  process.exit(0);
}
