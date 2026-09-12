import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { z } from 'zod';
import type { MeshConfig } from './storage.js';

export function desktopRows(database: string, query: string): unknown[] {
  const output = execFileSync(
    'sqlite3',
    ['-readonly', '-json', realpathSync(database), `PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; ${query}`],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10_000,
    }
  );
  return z.array(z.unknown()).parse(JSON.parse(output.trim() || '[]'));
}

const mac = (value: string): string => value.replace(/[^0-9a-f]/gi, '').toLowerCase();

export function desktopDeviceKeys(database: string, config: MeshConfig): MeshConfig {
  const meshes = z
    .array(z.object({ net_key: z.string(), app_key: z.string() }))
    .parse(desktopRows(database, 'SELECT net_key, app_key FROM mesh'));
  if (
    !meshes.some(
      (mesh) =>
        mesh.net_key.toLowerCase() === config.netKey.toLowerCase() &&
        mesh.app_key.toLowerCase() === config.appKey.toLowerCase()
    )
  )
    throw new Error('Desktop database does not match the configured mesh keys');
  const rows = z
    .array(
      z.object({ mac_address: z.string(), node_address: z.number(), device_key: z.string().regex(/^[0-9a-f]{32}$/i) })
    )
    .parse(desktopRows(database, 'SELECT mac_address, node_address, device_key FROM fixtures'));
  return {
    ...config,
    lights: config.lights.map((light) => {
      const row = rows.find((item) => mac(item.mac_address) === mac(light.mac) && item.node_address === light.address);
      if (!row) throw new Error(`No matching Device Key for ${light.name}`);
      return { ...light, deviceKey: row.device_key };
    }),
  };
}
