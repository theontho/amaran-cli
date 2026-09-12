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
