const COLORS: Record<string, string> = {
  red: 'ff0000',
  green: '008000',
  lime: '00ff00',
  blue: '0000ff',
  white: 'ffffff',
  yellow: 'ffff00',
  cyan: '00ffff',
  aqua: '00ffff',
  magenta: 'ff00ff',
  fuchsia: 'ff00ff',
  orange: 'ffa500',
  purple: '800080',
  pink: 'ffc0cb',
  violet: 'ee82ee',
  teal: '008080',
};

export function colorToHSI(value: unknown): { hue: number; saturation: number } {
  if (typeof value !== 'string') throw new Error('Color must be a name or #RRGGBB');
  let hex = COLORS[value.toLowerCase()] ?? value.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`Unsupported color: ${value}`);
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) throw new Error('Black has no hue; use intensity 0 or off instead');
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }
  return { hue: Math.round((hue + 360) % 360) % 360, saturation: Math.round((delta / max) * 100) };
}

export const SIMULATED_CCT_MIN = 1000;
export const SIMULATED_CCT_MAX = 20000;

const LOW_CCT_ANCHORS = [
  { kelvin: 1000, hue: 32, saturation: 90 },
  { kelvin: 1200, hue: 31, saturation: 84 },
  { kelvin: 1500, hue: 30, saturation: 72 },
  { kelvin: 2000, hue: 31, saturation: 58 },
  { kelvin: 2200, hue: 32, saturation: 47 },
  { kelvin: 2400, hue: 33, saturation: 36 },
  { kelvin: 2500, hue: 33, saturation: 36 },
];

const HIGH_CCT_ANCHORS = [
  { kelvin: 7500, hue: 200, saturation: 20 },
  { kelvin: 9000, hue: 210, saturation: 20 },
  { kelvin: 12000, hue: 220, saturation: 20 },
  { kelvin: 16000, hue: 220, saturation: 22 },
  { kelvin: 20000, hue: 220, saturation: 24 },
];

function interpolateAnchors(
  kelvin: number,
  anchors: { kelvin: number; hue: number; saturation: number }[]
): { hue: number; saturation: number } {
  const upper = anchors.findIndex((anchor) => anchor.kelvin >= kelvin);
  if (upper <= 0) return { hue: anchors[0].hue, saturation: anchors[0].saturation };
  const left = anchors[upper - 1];
  const right = anchors[upper];
  const fraction = (kelvin - left.kelvin) / (right.kelvin - left.kelvin);
  return {
    hue: Math.round(left.hue + (right.hue - left.hue) * fraction),
    saturation: Math.round(left.saturation + (right.saturation - left.saturation) * fraction),
  };
}

export function kelvinToHSI(kelvin: number): { hue: number; saturation: number } {
  if (!Number.isFinite(kelvin) || kelvin < SIMULATED_CCT_MIN || kelvin > SIMULATED_CCT_MAX)
    throw new Error(`Simulated CCT must be a finite number between ${SIMULATED_CCT_MIN} and ${SIMULATED_CCT_MAX}`);
  if (kelvin <= 2500) {
    // Camera-matched to native 2500K, with an amber floor that avoids red-only output at the lowest settings.
    return interpolateAnchors(kelvin, LOW_CCT_ANCHORS);
  }
  if (kelvin >= 7500) return interpolateAnchors(kelvin, HIGH_CCT_ANCHORS);
  const temperature = kelvin / 100;
  const red = temperature <= 66 ? 255 : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green =
    temperature <= 66
      ? 99.4708025861 * Math.log(temperature) - 161.1195681661
      : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue =
    temperature >= 66 ? 255 : temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  const hex = [red, green, blue]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
  return colorToHSI(hex);
}

export function inferSimulatedKelvin(
  hue: number | undefined,
  saturation: number | undefined,
  nativeMin: number,
  nativeMax: number
): number | undefined {
  if (hue === undefined || saturation === undefined) return undefined;
  const anchor = [...LOW_CCT_ANCHORS, ...HIGH_CCT_ANCHORS].find(
    (candidate) =>
      (candidate.kelvin < nativeMin || candidate.kelvin > nativeMax) &&
      candidate.hue === hue &&
      candidate.saturation === saturation
  );
  if (anchor) return anchor.kelvin;
  let best: { kelvin: number; distance: number } | undefined;
  for (let kelvin = SIMULATED_CCT_MIN; kelvin <= SIMULATED_CCT_MAX; kelvin += 100) {
    if (kelvin >= nativeMin && kelvin <= nativeMax) continue;
    const target = kelvinToHSI(kelvin);
    const distance = Math.abs(target.hue - hue) + Math.abs(target.saturation - saturation);
    if (!best || distance < best.distance) best = { kelvin, distance };
  }
  return best?.distance === 0 ? best.kelvin : undefined;
}
