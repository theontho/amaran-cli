import { setTimeout as delay } from 'node:timers/promises';
import type { Peripheral } from '@abandonware/noble';
import { deadline } from './async.js';

export interface UnprovisionedDevice {
  id: string;
  uuid: string;
  oobInformation: string;
  name?: string;
  rssi?: number;
}
export function provisioningAdvertisement(data: Buffer): { uuid: string; oobInformation: string } | undefined {
  if (data.length !== 18 && data.length !== 22) return undefined;
  return { uuid: data.subarray(0, 16).toString('hex'), oobInformation: data.subarray(16, 18).toString('hex') };
}
export async function discoverUnprovisioned(): Promise<UnprovisionedDevice[]> {
  const { default: noble } = await import('@abandonware/noble');
  if (noble._state !== 'poweredOn') throw new Error('Bluetooth must be powered on before discovery');
  const devices = new Map<string, UnprovisionedDevice>();
  const discover = (peripheral: Peripheral) => {
    for (const service of peripheral.advertisement.serviceData ?? []) {
      if (service.uuid !== '1827') continue;
      const data = provisioningAdvertisement(service.data);
      if (!data) continue;
      devices.set(data.uuid, {
        ...data,
        id: peripheral.id,
        name: peripheral.advertisement.localName,
        rssi: peripheral.rssi === 127 ? undefined : peripheral.rssi,
      });
    }
  };
  noble.on('discover', discover);
  try {
    await deadline(noble.startScanningAsync(['1827'], true), 5000, 'Provisioning scan start');
    await delay(5000);
  } finally {
    noble.removeListener('discover', discover);
    await deadline(noble.stopScanningAsync(), 3000, 'Provisioning scan stop');
  }
  return [...devices.values()];
}
