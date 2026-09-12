export interface MeshModel {
  element: number;
  model: number;
  company?: number;
}
export interface Composition {
  company: number;
  product: number;
  version: number;
  features: number;
  models: MeshModel[];
}
export interface ConfigurationLink {
  configuration(address: number, request: Buffer, accept: (data: Buffer) => boolean): Promise<Buffer>;
}
export async function readConfiguration(
  link: ConfigurationLink,
  address: number,
  request: Buffer,
  accept: (data: Buffer) => boolean
): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await link.configuration(address, request, accept);
    } catch (error) {
      if (attempt === 1) throw error;
      console.error(
        `Configuration read ${request.subarray(0, 2).toString('hex')} from ${address} failed; retrying: ${(error as Error).message}`
      );
      await delay(200);
    }
  }
}

export function composition(data: Buffer, primary: number): Composition {
  if (data.length < 12 || data[0] !== 2 || data[1] !== 0) throw new Error('Invalid composition status');
  const models: MeshModel[] = [];
  let offset = 12,
    element = primary;
  while (offset < data.length) {
    if (offset + 4 > data.length) throw new Error('Truncated composition element');
    const sig = data[offset + 2],
      vendor = data[offset + 3];
    offset += 4;
    if (offset + sig * 2 + vendor * 4 > data.length) throw new Error('Truncated composition model list');
    for (let i = 0; i < sig; i++, offset += 2) models.push({ element, model: data.readUInt16LE(offset) });
    for (let i = 0; i < vendor; i++, offset += 4)
      models.push({ element, company: data.readUInt16LE(offset), model: data.readUInt16LE(offset + 2) });
    element++;
  }
  return {
    company: data.readUInt16LE(2),
    product: data.readUInt16LE(4),
    version: data.readUInt16LE(6),
    features: data.readUInt16LE(10),
    models,
  };
}

function modelBytes(model: MeshModel): Buffer {
  const data = Buffer.alloc(model.company === undefined ? 2 : 4);
  if (model.company !== undefined) data.writeUInt16LE(model.company);
  data.writeUInt16LE(model.model, data.length - 2);
  return data;
}
export async function readComposition(link: ConfigurationLink, address: number): Promise<Composition> {
  return composition(
    await readConfiguration(link, address, Buffer.from([0x80, 0x08, 0]), (data) => data[0] === 2 && data[1] === 0),
    address
  );
}
export async function modelBindings(link: ConfigurationLink, address: number, model: MeshModel): Promise<number[]> {
  const header = Buffer.alloc(4);
  header[0] = 0x80;
  header[1] = model.company === undefined ? 0x4b : 0x4d;
  header.writeUInt16LE(model.element, 2);
  const id = modelBytes(model);
  const response = await readConfiguration(
    link,
    address,
    Buffer.concat([header, id]),
    (data) =>
      data.length >= 5 + id.length &&
      data[0] === 0x80 &&
      data[1] === header[1] + 1 &&
      data.readUInt16LE(3) === model.element &&
      data.subarray(5, 5 + id.length).equals(id)
  );
  if (response[2] !== 0) throw new Error(`App binding read failed with mesh status ${response[2]}`);
  const indexes: number[] = [];
  for (let offset = 5 + id.length; offset < response.length; offset += 3) {
    if (offset + 2 > response.length) throw new Error('Truncated app index list');
    indexes.push(response.readUInt16LE(offset) & 0xfff);
    if (offset + 3 <= response.length) indexes.push(response.readUInt16LE(offset + 1) >> 4);
  }
  return indexes;
}
export async function subscriptions(link: ConfigurationLink, address: number, model: MeshModel): Promise<number[]> {
  const header = Buffer.alloc(4);
  header[0] = 0x80;
  header[1] = model.company === undefined ? 0x29 : 0x2b;
  header.writeUInt16LE(model.element, 2);
  const id = modelBytes(model);
  const response = await readConfiguration(
    link,
    address,
    Buffer.concat([header, id]),
    (data) =>
      data.length >= 5 + id.length &&
      data[0] === 0x80 &&
      data[1] === header[1] + 1 &&
      data.readUInt16LE(3) === model.element &&
      data.subarray(5, 5 + id.length).equals(id)
  );
  if (response[2] !== 0) throw new Error(`Subscription read failed with mesh status ${response[2]}`);
  const start = 5 + id.length;
  if ((response.length - start) % 2) throw new Error('Truncated subscription addresses');
  return Array.from({ length: (response.length - start) / 2 }, (_, i) => response.readUInt16LE(start + i * 2));
}
export async function changeSubscription(
  link: ConfigurationLink,
  address: number,
  model: MeshModel,
  group: number,
  remove: boolean
): Promise<void> {
  if (!Number.isInteger(group) || group < 0xc000 || group > 0xfeff)
    throw new Error('Group address must be 0xc000-0xfeff');
  const header = Buffer.alloc(6);
  header[0] = 0x80;
  header[1] = remove ? 0x1c : 0x1b;
  header.writeUInt16LE(model.element, 2);
  header.writeUInt16LE(group, 4);
  const id = modelBytes(model);
  let response: Buffer;
  try {
    response = await link.configuration(
      address,
      Buffer.concat([header, id]),
      (data) =>
        data.length === 7 + id.length &&
        data[0] === 0x80 &&
        data[1] === 0x1f &&
        data.readUInt16LE(3) === model.element &&
        data.readUInt16LE(5) === group &&
        data.subarray(7).equals(id)
    );
  } catch (error) {
    const actual = await subscriptions(link, address, model);
    if (actual.includes(group) !== remove) return;
    throw new Error(`Subscription write did not verify: ${(error as Error).message}`, { cause: error });
  }
  if (response[2] !== 0) throw new Error(`Subscription change failed with mesh status ${response[2]}`);
  const actual = await subscriptions(link, address, model);
  if (actual.includes(group) === remove) throw new Error('Subscription change did not verify');
}

import { setTimeout as delay } from 'node:timers/promises';
