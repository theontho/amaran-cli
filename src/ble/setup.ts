import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MeshCrypto } from './crypto.js';
import { atomicJson, MeshConfigSchema, type MeshLight, meshDirectory } from './storage.js';

export function importMesh(filename: string, source = 0x7ffe, directory = meshDirectory()): void {
  const output = path.join(directory, 'mesh.json');
  if (existsSync(output) || existsSync(path.join(directory, 'sequence.json'))) {
    throw new Error('BLE configuration already exists. Do not reset sequence state on a provisioned network.');
  }
  const old = z
    .object({
      netKey: z.string(),
      appKey: z.string(),
      lights: z.array(z.object({ key: z.string(), name: z.string(), mac: z.string(), address: z.number() })),
    })
    .parse(JSON.parse(readFileSync(filename, 'utf8')));
  const lights: MeshLight[] = old.lights.map((light) => {
    const name = light.name.toLowerCase();
    const model = name.includes('150c') ? '150c' : name.includes('200x') ? '200x-s' : undefined;
    if (!model)
      throw new Error(`Unrecognized fixture model for "${light.name}"; only 200x/200x S and 150c are supported`);
    return { ...light, model };
  });
  const config = MeshConfigSchema.parse({ netKey: old.netKey, appKey: old.appKey, lights, source });
  const crypto = new MeshCrypto(config.netKey, config.appKey);
  atomicJson(path.join(directory, 'sequence.json'), { networkId: crypto.networkId.toString('hex'), source, next: 0 });
  atomicJson(output, config);
  console.log(
    `Imported ${lights.length} fixtures to ${output}. Keep this private; back up its sequence state with it.`
  );
}
