import path from 'node:path';
import { loadConfig, saveConfig } from '../config.js';
import { updateCircadianDashboardSettings } from '../daylightSimulation/dashboardSettings.js';
import { getCircadianDashboardStatus } from '../daylightSimulation/dashboardStatus.js';
import { VerifiedController } from './controller.js';
import { MeshCrypto } from './crypto.js';
import { DashboardStore } from './dashboard.js';
import { LocalLibrary } from './library.js';
import { createBleServer } from './server.js';
import { atomicJson, loadMeshConfig, meshDirectory, SequenceStore } from './storage.js';
import { MeshTransport } from './transport.js';

export async function serveBle(port = 2708, debug = false): Promise<void> {
  const config = loadMeshConfig();
  const appConfig = loadConfig();
  const crypto = new MeshCrypto(config.netKey, config.appKey);
  const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
  const link = new MeshTransport(config, sequence, debug);
  const library = new LocalLibrary(meshDirectory());
  const dashboard = new DashboardStore(
    meshDirectory(),
    config.lights.map((light) => light.key)
  );
  const controller = new VerifiedController(config, link, library);
  let circadianCache: { expiresAt: number; value: Awaited<ReturnType<typeof getCircadianDashboardStatus>> } | undefined;
  const server = createBleServer(controller, library, {
    persistMesh: (value) => atomicJson(path.join(meshDirectory(), 'mesh.json'), value),
    dashboard,
    luxCalibration: appConfig?.maxLux,
    luxByModel: appConfig?.maxLuxByModel,
    circadianStatus: async () => {
      if (circadianCache && circadianCache.expiresAt > Date.now()) return circadianCache.value;
      const value = await getCircadianDashboardStatus({ loadConfig });
      circadianCache = { expiresAt: Date.now() + 30_000, value };
      return value;
    },
    updateCircadianSettings: async (value) => {
      await updateCircadianDashboardSettings(value, { loadConfig, saveConfig });
      circadianCache = undefined;
      const status = await getCircadianDashboardStatus({ loadConfig });
      circadianCache = { expiresAt: Date.now() + 30_000, value: status };
      return status;
    },
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
