import { describe, expect, it, vi } from 'vitest';
import { LocalLibrary } from '../ble/library.js';
import { NativeGroups } from '../ble/nativeGroups.js';
import { provisioningAdvertisement } from '../ble/provisioning.js';
import type { MeshConfig } from '../ble/storage.js';

const config: MeshConfig = {
  netKey: '0'.repeat(32),
  appKey: '1'.repeat(32),
  source: 32766,
  lights: [
    { key: 'desk', name: 'Desk', mac: '', address: 6, model: '200x-s' },
    { key: 'back', name: 'Back', mac: '', address: 10, model: '150c' },
  ],
};
function link() {
  const groups = new Map([
    [6, new Set([0xc000])],
    [10, new Set([0xc000])],
  ]);
  let fail = false;
  const configuration = vi.fn(async (address: number, request: Buffer, accept: (data: Buffer) => boolean) => {
    const opcode = request.readUInt16BE();
    let data: Buffer;
    if (opcode === 0x8008) data = Buffer.from('020011020000000001000300000001000010', 'hex');
    else if (opcode === 0x8015) data = Buffer.from('801700000000', 'hex');
    else {
      const set = groups.get(address);
      if (!set) throw new Error('unknown fixture');
      if (opcode === 0x801b || opcode === 0x801c) {
        if (fail && address === 10 && opcode === 0x801b) throw new Error('lost connection');
        const group = request.readUInt16LE(4);
        if (opcode === 0x801b) set.add(group);
        else set.delete(group);
        data = Buffer.concat([Buffer.from([0x80, 0x1f, 0]), request.subarray(2)]);
      } else {
        const addresses = Buffer.alloc(opcode === 0x804b ? 2 : set.size * 2);
        if (opcode !== 0x804b)
          [...set].forEach((value, index) => {
            addresses.writeUInt16LE(value, index * 2);
          });
        data = Buffer.concat([Buffer.from([0x80, opcode === 0x804b ? 0x4c : 0x2a, 0]), request.subarray(2), addresses]);
      }
    }
    expect(accept(data)).toBe(true);
    return data;
  });
  return {
    configuration,
    groups,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

describe('native group lifecycle', () => {
  it('adds, synchronizes and removes only its owned address', async () => {
    const transport = link(),
      library = new LocalLibrary();
    const group = library.createGroup('Work');
    library.updateGroup(group.id, 'desk', false);
    const native = new NativeGroups(config, transport, library);
    const enabled = await native.enable(group.id);
    expect(enabled.native?.status).toBe('ready');
    expect(transport.groups.get(6)?.has(0xc100)).toBe(true);
    expect(transport.groups.get(10)?.has(0xc100)).toBe(false);
    await native.member(group.id, 'back', false);
    expect(transport.groups.get(10)?.has(0xc100)).toBe(true);
    await native.disable(group.id);
    expect(transport.groups.get(6)).toEqual(new Set([0xc000]));
    expect(transport.groups.get(10)).toEqual(new Set([0xc000]));
    expect(library.group(group.id).native).toBeUndefined();
  });
  it('journals a partial operation and can resume or disable without deleting unrelated subscriptions', async () => {
    const transport = link(),
      library = new LocalLibrary();
    const group = library.createGroup('Work');
    for (const key of ['desk', 'back']) library.updateGroup(group.id, key, false);
    const native = new NativeGroups(config, transport, library);
    transport.fail(true);
    await expect(native.enable(group.id)).rejects.toThrow('did not verify');
    expect(library.group(group.id).native?.status).toBe('pending');
    expect(() => library.deleteGroup(group.id)).toThrow('Disable native');
    transport.fail(false);
    await native.sync(group.id);
    expect(library.group(group.id).native?.status).toBe('ready');
    await native.disable(group.id);
    expect(transport.groups.get(6)).toEqual(new Set([0xc000]));
  });
  it('refuses an address already used by another group and only parses provisioning advertisements', async () => {
    const transport = link(),
      library = new LocalLibrary();
    const group = library.createGroup('Work');
    library.updateGroup(group.id, 'desk', false);
    await expect(new NativeGroups(config, transport, library).enable(group.id, 0xc000)).rejects.toThrow('unused');
    expect(library.group(group.id).native).toBeUndefined();
    expect(provisioningAdvertisement(Buffer.alloc(9))).toBeUndefined();
    expect(provisioningAdvertisement(Buffer.alloc(18))).toEqual({ uuid: '0'.repeat(32), oobInformation: '0000' });
  });
});
