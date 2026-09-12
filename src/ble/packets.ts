export function numberInRange(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function packet(type: number, bits = 0n): Buffer {
  const data = Buffer.alloc(10);
  data.writeBigUInt64LE(bits & 0xffffffffffffffffn);
  data[8] = Number((bits >> 64n) & 255n);
  data[9] = type;
  data[0] = data.subarray(1).reduce((sum, value) => sum + value, 0) & 255;
  return data;
}
