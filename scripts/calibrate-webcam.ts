import { readdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { MeshCrypto } from '../src/ble/crypto.js';
import { loadMeshConfig, meshDirectory, SequenceStore } from '../src/ble/storage.js';
import { cctPacket, type FixtureState, powerPacket } from '../src/ble/telink.js';
import { MeshTransport } from '../src/ble/transport.js';
import { type CameraRegion, captureWebcam, imagePixels, regionsFile } from './webcam.js';

function locateLight(dark: Buffer, lit: Buffer, name: string): CameraRegion {
  const width = 320;
  const height = 180;
  const mask = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      let bright = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const offset = ((y + dy) * 4 * 1280 + (x + dx) * 4) * 3;
          const light = (lit[offset] + lit[offset + 1] + lit[offset + 2]) / 3;
          const before = (dark[offset] + dark[offset + 1] + dark[offset + 2]) / 3;
          if (light < 248 || light - before < 65) bright = false;
        }
      if (bright) mask[y * width + x] = 1;
    }
  const candidates: { count: number; x: number; y: number; width: number; height: number }[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    const queue = [start];
    mask[start] = 0;
    let minX = width,
      maxX = 0,
      minY = height,
      maxY = 0;
    for (let i = 0; i < queue.length; i++) {
      const index = queue[i],
        x = index % width,
        y = Math.floor(index / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const next of [
        index - width,
        index + width,
        ...(x > 0 ? [index - 1] : []),
        ...(x < width - 1 ? [index + 1] : []),
      ]) {
        if (next >= 0 && next < mask.length && mask[next]) {
          mask[next] = 0;
          queue.push(next);
        }
      }
    }
    const w = maxX - minX + 1,
      h = maxY - minY + 1;
    if (queue.length >= 8 && w / h > 0.35 && w / h < 2.8 && w < 70 && h < 70) {
      candidates.push({ count: queue.length, x: (minX + maxX) * 2, y: (minY + maxY) * 2, width: w * 4, height: h * 4 });
    }
  }
  candidates.sort((a, b) => b.count - a.count);
  const best = candidates[0];
  if (!best || (candidates[1] && candidates[1].count > best.count * 0.7))
    throw new Error(`Cannot identify a unique emitting fixture for ${name}: ${JSON.stringify(candidates)}`);
  const size = Math.max(8, Math.min(24, Math.floor(Math.min(best.width, best.height) / 2)));
  return { name, x: Math.round(best.x - size / 2), y: Math.round(best.y - size / 2), width: size, height: size };
}

const config = loadMeshConfig();
if (process.argv.includes('--reuse')) {
  const capture = readdirSync('artifacts/webcam')
    .filter((name) => /^calibration-\d+-off\.png$/.test(name))
    .sort()
    .at(-1);
  if (!capture) throw new Error('No saved calibration captures');
  const prefix = `artifacts/webcam/${capture.replace(/-off\.png$/, '')}`;
  const dark = imagePixels(`${prefix}-off.png`);
  const regions = config.lights.map((light) => locateLight(dark, imagePixels(`${prefix}-${light.key}.png`), light.key));
  writeFileSync(
    regionsFile,
    JSON.stringify(
      { cameraIndex: process.env.AMARAN_CAMERA_INDEX ?? '0', capturedAt: new Date().toISOString(), regions },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(prefix, regions);
  process.exit(0);
}
const crypto = new MeshCrypto(config.netKey, config.appKey);
const sequence = new SequenceStore(meshDirectory(), crypto.networkId.toString('hex'), config.source);
const transport = new MeshTransport(config, sequence);
const original = new Map<number, FixtureState>();
const regions: CameraRegion[] = [];
const errors: unknown[] = [];
try {
  await transport.connect();
  for (const light of config.lights) {
    const state = await transport.readState(light.address);
    if (state.mode !== 'cct')
      throw new Error('Camera calibration currently requires CCT mode so all settings can be restored');
    original.set(light.address, state);
  }
  for (const light of config.lights) await transport.send(light.address, powerPacket(false));
  await delay(300);
  const stamp = Date.now();
  const dark = imagePixels(captureWebcam(`calibration-${stamp}-off`));
  for (const light of config.lights) {
    await transport.send(light.address, cctPacket(3200, 10, 0));
    await delay(300);
    const frame = captureWebcam(`calibration-${stamp}-${light.key}`);
    regions.push(locateLight(dark, imagePixels(frame), light.key));
    await transport.send(light.address, powerPacket(false));
    await delay(300);
  }
  writeFileSync(
    regionsFile,
    JSON.stringify(
      { cameraIndex: process.env.AMARAN_CAMERA_INDEX ?? '0', capturedAt: new Date().toISOString(), regions },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log('Identified fixture regions:', regions);
} catch (error) {
  errors.push(error);
} finally {
  for (const light of config.lights) {
    const state = original.get(light.address);
    if (!state) continue;
    try {
      await transport.send(light.address, cctPacket(state.cct ?? 3200, state.intensity, state.gm ?? 0));
      await delay(200);
      await transport.send(light.address, powerPacket(!state.sleep));
      const actual = await transport.readState(light.address);
      if (
        actual.cct !== state.cct ||
        actual.intensity !== state.intensity ||
        actual.sleep !== state.sleep ||
        (light.model === '150c' && actual.gm !== state.gm)
      )
        errors.push(new Error(`Failed to restore ${light.key}`));
    } catch (error) {
      errors.push(error);
    }
  }
  await transport.disconnect();
  sequence.close();
}
if (errors.length) throw new AggregateError(errors, 'Camera calibration failed');
process.exit(0);
