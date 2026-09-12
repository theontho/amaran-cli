import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const RegionSchema = z
  .object({
    name: z.string(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .refine((r) => r.x + r.width <= 1280 && r.y + r.height <= 720, 'Camera ROI is outside the frame');
export type CameraRegion = z.infer<typeof RegionSchema>;
export const regionsFile = path.resolve('artifacts/webcam/regions.json');

export function imagePixels(filename: string): Buffer {
  const pixels = execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', filename, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { timeout: 10_000, maxBuffer: 1280 * 720 * 3 + 1024 }
  );
  if (pixels.length !== 1280 * 720 * 3) throw new Error('Unexpected camera frame dimensions');
  return pixels;
}

export function measureRegion(rgb: Buffer, region: CameraRegion) {
  const sum = [0, 0, 0];
  let clipped = 0;
  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const offset = (y * 1280 + x) * 3;
      for (let channel = 0; channel < 3; channel++) sum[channel] += rgb[offset + channel];
      if (Math.max(rgb[offset], rgb[offset + 1], rgb[offset + 2]) >= 250) clipped++;
    }
  }
  const pixels = region.width * region.height;
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const inner = Math.max(region.width, region.height);
  const outer = inner * 2;
  const halo = [0, 0, 0];
  let haloPixels = 0;
  // The directly facing emitter clips white; its surrounding halo retains color information.
  for (let y = Math.max(0, Math.floor(centerY - outer)); y < Math.min(720, centerY + outer); y++) {
    for (let x = Math.max(0, Math.floor(centerX - outer)); x < Math.min(1280, centerX + outer); x++) {
      const radius = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (radius < inner ** 2 || radius > outer ** 2) continue;
      const offset = (y * 1280 + x) * 3;
      if (Math.min(rgb[offset], rgb[offset + 1], rgb[offset + 2]) >= 245) continue;
      for (let channel = 0; channel < 3; channel++) halo[channel] += rgb[offset + channel];
      haloPixels++;
    }
  }
  return {
    ...region,
    rgb: sum.map((value) => value / pixels),
    clippedFraction: clipped / pixels,
    haloRgb: haloPixels ? halo.map((value) => value / haloPixels) : undefined,
    haloPixels,
  };
}

export function captureWebcam(label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('Camera label must contain only letters, numbers, - or _');
  const directory = path.resolve('artifacts/webcam');
  mkdirSync(directory, { recursive: true });
  chmodSync(directory, 0o700);
  const output = path.join(directory, `${label}.png`);
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'avfoundation',
      '-pixel_format',
      'nv12',
      '-framerate',
      '30',
      '-video_size',
      '1280x720',
      '-i',
      `${process.env.AMARAN_CAMERA_INDEX ?? '0'}:none`,
      '-vf',
      "select='gte(t,3)'",
      '-frames:v',
      '1',
      '-update',
      '1',
      '-n',
      output,
    ],
    { timeout: 20_000, stdio: ['ignore', 'ignore', 'pipe'] }
  );
  chmodSync(output, 0o600);
  const rgb = imagePixels(output);
  const calibration = existsSync(regionsFile)
    ? z
        .object({ cameraIndex: z.string(), regions: z.array(RegionSchema) })
        .parse(JSON.parse(readFileSync(regionsFile, 'utf8')))
    : undefined;
  if (calibration && calibration.cameraIndex !== (process.env.AMARAN_CAMERA_INDEX ?? '0'))
    throw new Error('Camera calibration belongs to a different camera');
  const regions = (calibration?.regions ?? []).map((region) => measureRegion(rgb, region));
  writeFileSync(
    output.replace(/\.png$/, '.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        note: calibration
          ? 'Calibrated fixture ROIs; automatic exposure/white balance, not a lux or CCT meter. Recalibrate after moving equipment.'
          : 'Uncalibrated: run scripts/calibrate-webcam.ts before optical assertions.',
        regions,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(captureWebcam(process.argv[2] ?? `capture-${Date.now()}`));
}
