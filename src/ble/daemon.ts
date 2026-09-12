import path from 'node:path';
import { VerifiedController } from './controller.js';
import { MeshCrypto } from './crypto.js';
import { LocalLibrary } from './library.js';
import { createBleServer } from './server.js';
import { atomicJson, loadMeshConfig, meshDirectory, SequenceStore } from './storage.js';
import { MeshTransport } from './transport.js';

export async function serveBle(port = 2708, debug = false): Promise<void> {
  const config = loadMeshConfig();
  const crypto = new MeshCrypto(config.netKey, config.appKey);
  const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
  const link = new MeshTransport(config, sequence, debug);
  const library = new LocalLibrary(meshDirectory());
  const controller = new VerifiedController(config, link, library);
  const server = createBleServer(controller, library, {
    persistMesh: (value) => atomicJson(path.join(meshDirectory(), 'mesh.json'), value),
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stopPrograms();
    server.close();
    server.closeIdleConnections();
    await controller.stop();
    sequence.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await link.connect();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    console.log(`Verified BLE API listening at http://127.0.0.1:${port}`);
  } catch (error) {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await server.stopPrograms();
    await controller.stop();
    sequence.close();
    throw error;
  }
}
