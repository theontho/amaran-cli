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

export function kelvinToHSI(kelvin: number): { hue: number; saturation: number } {
  if (!Number.isFinite(kelvin) || kelvin < 1000 || kelvin > 40000)
    throw new Error('Simulated CCT must be a finite number between 1000 and 40000');
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
