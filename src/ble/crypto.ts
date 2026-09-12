import { createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

export function aesBlock(key: Buffer, data: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function double(block: Buffer): Buffer {
  const result = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) result[i] = (block[i] << 1) | ((block[i + 1] ?? 0) >> 7);
  if (block[0] & 128) result[15] ^= 0x87;
  return result;
}

export function cmac(key: Buffer, message: Buffer): Buffer {
  const k1 = double(aesBlock(key, Buffer.alloc(16)));
  const k2 = double(k1);
  const complete = message.length > 0 && message.length % 16 === 0;
  const count = Math.max(1, Math.ceil(message.length / 16));
  let state: Buffer = Buffer.alloc(16);
  for (let i = 0; i < count; i++) {
    const block = Buffer.alloc(16);
    message.copy(block, 0, i * 16, (i + 1) * 16);
    if (i === count - 1) {
      if (!complete) block[message.length % 16] = 128;
      const subkey = complete ? k1 : k2;
      for (let j = 0; j < 16; j++) block[j] ^= subkey[j];
    }
    for (let j = 0; j < 16; j++) block[j] ^= state[j];
    state = aesBlock(key, block);
  }
  return state;
}

function s1(text: string): Buffer {
  return cmac(Buffer.alloc(16), Buffer.from(text));
}

export function encrypt(key: Buffer, nonce: Buffer, data: Buffer, mic = 4): Buffer {
  const cipher = createCipheriv('aes-128-ccm', key, nonce, { authTagLength: mic });
  cipher.setAAD(Buffer.alloc(0), { plaintextLength: data.length });
  const encrypted = cipher.update(data);
  cipher.final();
  return Buffer.concat([encrypted, cipher.getAuthTag()]);
}

export function decrypt(key: Buffer, nonce: Buffer, data: Buffer, mic = 4): Buffer {
  const cipher = createDecipheriv('aes-128-ccm', key, nonce, { authTagLength: mic });
  cipher.setAuthTag(data.subarray(-mic));
  cipher.setAAD(Buffer.alloc(0), { plaintextLength: data.length - mic });
  const plain = cipher.update(data.subarray(0, -mic));
  cipher.final();
  return plain;
}

export function nonce(
  type: number,
  flags: number,
  sequence: number,
  source: number,
  destination: number,
  iv: number
): Buffer {
  const result = Buffer.alloc(13);
  result[0] = type;
  result[1] = flags;
  result.writeUIntBE(sequence, 2, 3);
  result.writeUInt16BE(source, 5);
  result.writeUInt16BE(destination, 7);
  result.writeUInt32BE(iv, 9);
  return result;
}

export interface NetworkMessage {
  source: number;
  destination: number;
  sequence: number;
  iv: number;
  control: boolean;
  transport: Buffer;
}

export class MeshCrypto {
  readonly networkId: Buffer;
  readonly nid: number;
  readonly aid: number;
  private readonly encryption: Buffer;
  private readonly privacy: Buffer;
  private readonly beacon: Buffer;
  private readonly identity: Buffer;
  private readonly application: Buffer;

  constructor(networkKey: string, applicationKey: string) {
    if (![networkKey, applicationKey].every((key) => /^[0-9a-f]{32}$/i.test(key))) {
      throw new Error('Mesh keys must be 16-byte hexadecimal values');
    }
    const net = Buffer.from(networkKey, 'hex');
    this.application = Buffer.from(applicationKey, 'hex');
    const t = cmac(s1('smk2'), net);
    const t1 = cmac(t, Buffer.from([0, 1]));
    this.encryption = cmac(t, Buffer.concat([t1, Buffer.from([0, 2])]));
    this.privacy = cmac(t, Buffer.concat([this.encryption, Buffer.from([0, 3])]));
    this.nid = t1[15] & 127;
    this.aid = cmac(cmac(s1('smk4'), this.application), Buffer.from('id6\x01'))[15] & 63;
    this.networkId = cmac(cmac(s1('smk3'), net), Buffer.from('id64\x01')).subarray(8);
    this.beacon = cmac(cmac(s1('nkbk'), net), Buffer.from('id128\x01'));
    this.identity = cmac(cmac(s1('nkik'), net), Buffer.from('id128\x01'));
  }

  matchesAdvertisement(data: Buffer, addresses: number[]): boolean {
    if (data.length === 9 && data[0] === 0) return timingSafeEqual(data.subarray(1), this.networkId);
    if (data.length !== 17 || data[0] !== 1) return false;
    return addresses.some((address) => {
      const input = Buffer.alloc(16);
      data.copy(input, 6, 9);
      input.writeUInt16BE(address, 14);
      return timingSafeEqual(aesBlock(this.identity, input).subarray(8), data.subarray(1, 9));
    });
  }

  readBeacon(data: Buffer): number {
    if (data.length !== 22 || data[0] !== 1 || !timingSafeEqual(data.subarray(2, 10), this.networkId)) {
      throw new Error('Beacon does not identify this mesh network');
    }
    const signature = cmac(this.beacon, data.subarray(1, 14)).subarray(0, 8);
    if (!timingSafeEqual(signature, data.subarray(14))) throw new Error('Invalid mesh beacon authentication');
    if (data[1] & 1) throw new Error('Mesh key refresh is active; import current keys before controlling lights');
    return data.readUInt32BE(10);
  }

  private pecb(iv: number, encrypted: Buffer): Buffer {
    const data = Buffer.alloc(16);
    data.writeUInt32BE(iv, 5);
    encrypted.copy(data, 9, 0, 7);
    return aesBlock(this.privacy, data);
  }

  network(message: NetworkMessage, proxy = false): Buffer {
    const flags = (message.control ? 128 : 0) | (proxy ? 0 : 5);
    const header = Buffer.alloc(6);
    header[0] = flags;
    header.writeUIntBE(message.sequence, 1, 3);
    header.writeUInt16BE(message.source, 4);
    const destination = Buffer.alloc(2);
    destination.writeUInt16BE(message.destination);
    const encrypted = encrypt(
      this.encryption,
      nonce(proxy ? 3 : 0, proxy ? 0 : flags, message.sequence, message.source, 0, message.iv),
      Buffer.concat([destination, message.transport]),
      message.control ? 8 : 4
    );
    const mask = this.pecb(message.iv, encrypted);
    for (let i = 0; i < 6; i++) header[i] ^= mask[i];
    return Buffer.concat([Buffer.from([((message.iv & 1) << 7) | this.nid]), header, encrypted]);
  }

  readNetwork(data: Buffer, iv: number, proxy = false): NetworkMessage {
    if (data.length < 14 || (data[0] & 127) !== this.nid) throw new Error('Invalid mesh network PDU');
    if (data[0] >> 7 !== (iv & 1)) {
      if (iv === 0) throw new Error('Unexpected mesh IV index');
      iv--;
    }
    const header = Buffer.from(data.subarray(1, 7));
    const mask = this.pecb(iv, data.subarray(7));
    for (let i = 0; i < 6; i++) header[i] ^= mask[i];
    const source = header.readUInt16BE(4);
    const sequence = header.readUIntBE(1, 3);
    const control = Boolean(header[0] & 128);
    const plain = decrypt(
      this.encryption,
      nonce(proxy ? 3 : 0, proxy ? 0 : header[0], sequence, source, 0, iv),
      data.subarray(7),
      control ? 8 : 4
    );
    return { source, sequence, control, iv, destination: plain.readUInt16BE(), transport: plain.subarray(2) };
  }

  access(data: Buffer, sequence: number, source: number, destination: number, iv: number): Buffer {
    if (data.length > 11) throw new Error('Unsegmented mesh access payload exceeds 11 bytes');
    return Buffer.concat([
      Buffer.from([0x40 | this.aid]),
      encrypt(this.application, nonce(1, 0, sequence, source, destination, iv), data),
    ]);
  }

  readAccess(data: Buffer, message: NetworkMessage, sequence = message.sequence, largeMic = false): Buffer {
    return decrypt(
      this.application,
      nonce(1, largeMic ? 128 : 0, sequence, message.source, message.destination, message.iv),
      data,
      largeMic ? 8 : 4
    );
  }

  deviceAccess(key: string, data: Buffer, sequence: number, source: number, destination: number, iv: number): Buffer {
    if (!/^[0-9a-f]{32}$/i.test(key)) throw new Error('Invalid Device Key');
    if (data.length > 11) throw new Error('Configuration message needs segmented transmission');
    return Buffer.concat([
      Buffer.from([0]),
      encrypt(Buffer.from(key, 'hex'), nonce(2, 0, sequence, source, destination, iv), data),
    ]);
  }

  readDeviceAccess(
    key: string,
    data: Buffer,
    message: NetworkMessage,
    sequence = message.sequence,
    largeMic = false
  ): Buffer {
    if (!/^[0-9a-f]{32}$/i.test(key)) throw new Error('Invalid Device Key');
    return decrypt(
      Buffer.from(key, 'hex'),
      nonce(2, largeMic ? 128 : 0, sequence, message.source, message.destination, message.iv),
      data,
      largeMic ? 8 : 4
    );
  }
}
