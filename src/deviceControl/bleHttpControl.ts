import type { CommandArgs, CommandCallback, Device } from './types.js';

interface BleLight {
  key: string;
  name: string;
  mac?: string;
  address?: number;
}

interface BleLightsResponse {
  ok?: boolean;
  lights?: BleLight[];
  error?: string;
}

interface BleCommandResponse {
  ok?: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_BLE_URL = 'http://localhost:2708';
const UNSUPPORTED_MESSAGE = 'Command is not supported by the BLE backend';

export default class BleHttpController {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private devices: Device[] = [];

  constructor(baseUrl = DEFAULT_BLE_URL, apiKey?: string) {
    this.baseUrl = trimTrailingSlashes(baseUrl);
    this.apiKey = apiKey;
  }

  static async connect(baseUrl?: string, apiKey?: string): Promise<BleHttpController> {
    const controller = new BleHttpController(baseUrl, apiKey);
    await controller.refreshDevices();
    return controller;
  }

  public async disconnect(): Promise<void> {
    return;
  }

  public getDevices(): Device[] {
    return this.devices;
  }

  public getFixtureList(callback?: CommandCallback) {
    this.getDeviceList(callback);
  }

  public getDeviceList(callback?: CommandCallback) {
    this.refreshDevices()
      .then(() => callback?.(true, 'OK', { data: this.devices }))
      .catch((error) => callback?.(false, (error as Error).message));
  }

  public turnLightOn(nodeId: string, callback?: CommandCallback) {
    this.postLightCommand(nodeId, 'on', undefined, callback);
  }

  public turnLightOff(nodeId: string, callback?: CommandCallback) {
    this.postLightCommand(nodeId, 'off', undefined, callback);
  }

  public async turnOnAllLights(callback?: CommandCallback) {
    await this.postAllCommand('on', callback);
  }

  public async turnOffAllLights(callback?: CommandCallback) {
    await this.postAllCommand('off', callback);
  }

  public setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.postLightCommand(nodeId, 'brightness', { value: this.apiIntensityToPercent(intensity) }, callback);
  }

  public async setIntensityForAllLights(intensity: number, callback?: CommandCallback) {
    await this.postLightCommand('all', 'brightness', { value: this.apiIntensityToPercent(intensity) }, callback);
  }

  public setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback) {
    this.postLightCommand(nodeId, 'cct', this.cctBody(cct, intensity), callback);
  }

  public async setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback) {
    await this.postLightCommand('all', 'cct', this.cctBody(cct, intensity), callback);
  }

  public setHSI(
    nodeId: string,
    hue: number,
    sat: number,
    intensity: number,
    _cct?: number,
    _gm?: number,
    callback?: CommandCallback
  ) {
    this.postLightCommand(
      nodeId,
      'hsi',
      { brightness: this.apiIntensityToPercent(intensity), hue, saturation: sat },
      callback
    );
  }

  public async setHSIForAllLights(
    hue: number,
    sat: number,
    intensity: number,
    _cct?: number,
    _gm?: number,
    callback?: CommandCallback
  ) {
    await this.postLightCommand(
      'all',
      'hsi',
      { brightness: this.apiIntensityToPercent(intensity), hue, saturation: sat },
      callback
    );
  }

  public getNodeConfig(nodeId: string, callback?: CommandCallback) {
    const device = this.devices.find((entry) => entry.node_id === nodeId || entry.id === nodeId);
    if (!device) {
      callback?.(false, `Device "${nodeId}" not found`);
      return;
    }
    callback?.(true, 'OK', {
      data: {
        ...device,
        cct_support: true,
        cct_min: 2500,
        cct_max: 7500,
        hsi_support: true,
      },
    });
  }

  public getSceneList(callback?: CommandCallback) {
    callback?.(true, 'OK', { data: [] });
  }

  public getLightSleepStatus(_nodeId: string, callback?: CommandCallback) {
    callback?.(false, 'Power status is not available from the BLE HTTP backend');
  }

  public getIntensity(_nodeId: string, callback?: CommandCallback) {
    callback?.(false, 'Intensity status is not available from the BLE HTTP backend');
  }

  public getCCT(_nodeId: string, callback?: CommandCallback) {
    callback?.(false, 'CCT status is not available from the BLE HTTP backend');
  }

  public getHSI(_nodeId: string, callback?: CommandCallback) {
    callback?.(false, 'HSI status is not available from the BLE HTTP backend');
  }

  public async toggleAllLights(callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public toggleLight(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public incrementIntensity(_nodeId: string, _delta: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public async incrementIntensityForAllLights(_delta: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public incrementCCT(_nodeId: string, _delta: number, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public async incrementCCTForAllLights(_delta: number, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setColor(_nodeId: string, _color: string, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public async setColorForAllLights(_color: string, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getRGB(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setRGB(_nodeId: string, _r: number, _g: number, _b: number, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getXY(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setXY(_nodeId: string, _x: number, _y: number, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getSystemEffect(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getSystemEffectList(callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setSystemEffect(_nodeId: string, _effectType: string, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public async setSystemEffectForAllLights(_effectType: string, _intensity?: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getEffect(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setEffect(_nodeId: string, _effectName: string, _args?: CommandArgs, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setEffectSpeed(_nodeId: string, _speed: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setEffectIntensity(_nodeId: string, _intensity: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getFanMode(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setFanMode(_nodeId: string, _mode: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getFanSpeed(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setFanSpeed(_nodeId: string, _speed: number, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getPresetList(callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public recallPreset(_nodeId: string, _presetId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setPreset(_nodeId: string, _presetId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getQuickshotList(callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public setQuickshot(_quickshotId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public saveScene(_name: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public deleteScene(_sceneId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public recallScene(_sceneId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public updateScene(_sceneId: string, _name?: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getGroupList(callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public createGroup(_name: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public deleteGroup(_groupId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public addToGroup(_groupId: string, _nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public removeFromGroup(_groupId: string, _nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  public getDeviceInfo(nodeId: string, callback?: CommandCallback) {
    this.getNodeConfig(nodeId, callback);
  }

  public updateFirmware(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  private async refreshDevices(): Promise<void> {
    const response = await this.request<BleLightsResponse>('/', { method: 'GET' });
    if (response.ok === false) {
      throw new Error(response.error || 'BLE backend returned an error');
    }
    this.devices = (response.lights ?? []).map((light) => ({
      ...light,
      id: light.key,
      node_id: light.key,
      device_name: light.name,
      name: light.name,
      device_type: 'ble-light',
      backend: 'ble',
    }));
  }

  private async postAllCommand(command: 'on' | 'off', callback?: CommandCallback): Promise<void> {
    await this.runCommand(`/lights/${command}`, {}, callback);
  }

  private async postLightCommand(
    nodeId: string,
    command: 'on' | 'off' | 'brightness' | 'cct' | 'hsi',
    body?: Record<string, unknown>,
    callback?: CommandCallback
  ): Promise<void> {
    await this.runCommand(`/lights/${encodeURIComponent(nodeId)}/${command}`, body ?? {}, callback);
  }

  private async runCommand(path: string, body: Record<string, unknown>, callback?: CommandCallback): Promise<void> {
    try {
      const response = await this.request<BleCommandResponse>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (response.ok === false) {
        callback?.(false, response.error || 'BLE backend returned an error');
        return;
      }
      callback?.(true, 'OK', response.result);
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `BLE backend HTTP ${response.status}`);
    }
    return data;
  }

  private cctBody(cct: number, intensity?: number): Record<string, unknown> {
    return {
      kelvin: cct,
      ...(intensity !== undefined ? { brightness: this.apiIntensityToPercent(intensity) } : {}),
    };
  }

  private apiIntensityToPercent(intensity: number): number {
    return Math.max(0, Math.min(100, intensity / 10));
  }

  private unsupported(callback?: CommandCallback) {
    callback?.(false, UNSUPPORTED_MESSAGE);
  }
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}
