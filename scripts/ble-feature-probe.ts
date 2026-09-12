import { writeFileSync } from 'node:fs';
import { MeshCrypto } from '../src/ble/crypto.js';
import { packet } from '../src/ble/packets.js';
import { decodeProductInfo } from '../src/ble/settings.js';
import { loadMeshConfig, meshDirectory, SequenceStore } from '../src/ble/storage.js';
import { MeshTransport } from '../src/ble/transport.js';

const config = loadMeshConfig();
const crypto = new MeshCrypto(config.netKey, config.appKey);
const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
const link = new MeshTransport(config, sequence);
const results: unknown[] = [];
try {
  await link.connect();
  for (const light of config.lights) {
    const info = await link.readPacket(light.address, packet(0), decodeProductInfo);
    console.log(light.key, info);
    let dimming: unknown;
    try {
      dimming = await link.readPacket(light.address, packet(8), (data) => {
        if (data.length !== 10 || (data[9] & 127) !== 8) return undefined;
        if ((data.subarray(1).reduce((sum, byte) => sum + byte, 0) & 255) !== data[0])
          throw new Error('Invalid curve checksum');
        return { mode: data[8], raw: data.toString('hex') };
      });
    } catch (error) {
      dimming = { unavailable: (error as Error).message };
    }
    console.log(light.key, 'dimming query', dimming);
    results.push({ key: light.key, info, dimming });
  }
} finally {
  await link.disconnect();
  sequence.close();
  writeFileSync(`artifacts/feature-probe-${Date.now()}.json`, JSON.stringify(results, null, 2), { mode: 0o600 });
}
process.exit(0);
