export interface ProductInfo {
  driverSoftware: number;
  driverHardware: number;
  controllerSoftware: number;
  controllerHardware: number;
  protocolVersion: number;
  cctMin: number;
  cctMax: number;
  effects: { manual: boolean; music: boolean; picker: boolean; program: boolean; touchbar: boolean };
}

export function decodeProductInfo(data: Buffer): ProductInfo | undefined {
  if (data.length !== 10 || (data[9] & 127) !== 0) return undefined;
  if ((data.subarray(1).reduce((sum, byte) => sum + byte, 0) & 255) !== data[0])
    throw new Error('Invalid product information checksum');
  const bits = data.readBigUInt64LE() | (BigInt(data[8]) << 64n);
  const field = (offset: bigint, mask: bigint) => Number((bits >> offset) & mask);
  return {
    driverSoftware: field(10n, 63n),
    driverHardware: field(16n, 63n),
    controllerSoftware: field(22n, 63n),
    controllerHardware: field(28n, 63n),
    protocolVersion: field(66n, 63n),
    cctMin: field(50n, 127n) * 100,
    cctMax: field(43n, 127n) * 100,
    effects: {
      manual: !!field(38n, 1n),
      music: !!field(34n, 1n),
      picker: !!field(36n, 1n),
      program: !!field(37n, 1n),
      touchbar: !!field(35n, 1n),
    },
  };
}
