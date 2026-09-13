import { z } from 'zod';
import { FanStateSchema, FanStatesSchema } from '../ble/fan.js';
import { parseFanMode, validateFanRpm } from '../ble/telink.js';
import type { CommandArgs, CommandCallback, Device } from './types.js';

interface BleLight {
  key: string;
  name: string;
  mac?: string;
  address?: number;
  model?: string;
  capabilities?: Record<string, unknown>;
}

interface BleLightsResponse {
  ok?: boolean;
  daemon?: boolean;
  protocolVersion?: number;
  connected?: boolean;
  lights?: BleLight[];
  error?: string;
  features?: Record<string, boolean | undefined>;
  groups?: { id: string; name: string; members: string[] }[];
}

interface BleCommandResponse {
  ok?: boolean;
  verified?: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_BLE_URL = 'http://localhost:2708';
const REQUEST_TIMEOUT_MS = 60_000;
const UNSUPPORTED_MESSAGE = 'Command is not supported by the BLE backend';

export default class BleHttpController {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private devices: Device[] = [];
  private features: NonNullable<BleLightsResponse['features']> = {};

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

  public async getHealth(callback?: CommandCallback) {
    try {
      const response = await this.request<BleLightsResponse>('/', { method: 'GET' });
      if (response.ok !== true) throw new Error(response.error || 'BLE backend returned an error');
      callback?.(true, 'OK', { data: response });
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  public turnLightOn(nodeId: string, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'on', undefined, callback);
  }

  public turnLightOff(nodeId: string, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'off', undefined, callback);
  }

  public async turnOnAllLights(callback?: CommandCallback) {
    await this.postEachLightCommand('on', {}, callback);
  }

  public async turnOffAllLights(callback?: CommandCallback) {
    await this.postEachLightCommand('off', {}, callback);
  }

  public setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'brightness', { value: this.apiIntensityToPercent(intensity) }, callback);
  }

  public async setIntensityForAllLights(intensity: number, callback?: CommandCallback) {
    await this.postEachLightCommand('brightness', { value: this.apiIntensityToPercent(intensity) }, callback);
  }

  public setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'cct', this.cctBody(cct, intensity), callback);
  }
  public async setAutomaticCCT(
    nodeId: string,
    cct: number,
    intensity: number,
    callback?: CommandCallback
  ): Promise<void> {
    if (!this.features.automaticCct) {
      await this.setCCT(nodeId, cct, intensity, callback);
      return;
    }
    try {
      const response = await this.request<BleCommandResponse>(`/lights/${encodeURIComponent(nodeId)}/auto-cct`, {
        method: 'POST',
        body: JSON.stringify(this.cctBody(cct, intensity)),
      });
      if (response.ok !== true) throw new Error(response.error || 'Automatic CCT failed');
      const result = z
        .discriminatedUnion('skipped', [
          z.object({
            skipped: z.literal(true),
            reason: z.enum(['manual-override', 'light-off', 'thermal-protection', 'stopped-cooling']),
          }),
          z.object({ skipped: z.literal(false), state: z.unknown() }),
        ])
        .parse(response.result);
      if (!result.skipped && response.verified !== true) throw new Error('Automatic CCT was not verified');
      if (!result.skipped) {
        const state = this.stateRecord(result.state);
        if (state.mode !== 'cct' || typeof state.cct !== 'number')
          throw new Error('Automatic CCT returned invalid state');
      }
      callback?.(true, result.skipped ? `Skipped: ${result.reason}` : 'OK', result);
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }
  public overrides(targets: 'all' | string[], minutes: number | undefined, callback?: CommandCallback) {
    return this.libraryRequest(
      '/overrides',
      'POST',
      { targets, ...(minutes === undefined ? {} : { minutes }) },
      callback
    );
  }
  public getProductInfo(nodeId: string, callback?: CommandCallback) {
    return this.libraryRequest(`/lights/${encodeURIComponent(nodeId)}/info`, 'GET', undefined, callback);
  }
  public renameGroup(groupId: string, name: string, callback?: CommandCallback) {
    return this.libraryRequest(`/groups/${encodeURIComponent(groupId)}/rename`, 'POST', { name }, callback);
  }
  public getGroup(groupId: string, callback?: CommandCallback) {
    return this.libraryRequest(`/groups/${encodeURIComponent(groupId)}`, 'GET', undefined, callback);
  }
  public nativeGroup(
    groupId: string,
    action: 'enable' | 'sync' | 'disable',
    address: number | undefined,
    callback?: CommandCallback
  ) {
    return this.libraryRequest(
      `/groups/${encodeURIComponent(groupId)}/native`,
      'POST',
      { action, ...(address === undefined ? {} : { address }) },
      callback
    );
  }
  public inspectMesh(callback?: CommandCallback) {
    return this.libraryRequest('/mesh/inspect', 'GET', undefined, callback);
  }
  public discoverUnprovisioned(callback?: CommandCallback) {
    return this.libraryRequest('/mesh/discover', 'GET', undefined, callback);
  }
  public importDeviceKeys(database: string, callback?: CommandCallback) {
    return this.libraryRequest('/mesh/keys', 'POST', { database }, callback);
  }
  public importDesktop(
    database: string,
    options: { apply: boolean; replace: boolean; allowPartial: boolean; prefix: string },
    callback?: CommandCallback
  ) {
    return this.libraryRequest('/desktop/import', 'POST', { database, ...options }, callback);
  }
  public startProgram(program: Record<string, unknown>, callback?: CommandCallback) {
    return this.libraryRequest('/programs', 'POST', program, callback);
  }
  public getPrograms(id: string | undefined, callback?: CommandCallback) {
    return this.libraryRequest(id ? `/programs/${encodeURIComponent(id)}` : '/programs', 'GET', undefined, callback);
  }
  public stopProgram(id: string, callback?: CommandCallback) {
    return this.libraryRequest(`/programs/${encodeURIComponent(id)}`, 'DELETE', undefined, callback);
  }
  public programSample(id: string, sample: Record<string, unknown>, callback?: CommandCallback) {
    return this.libraryRequest(`/programs/${encodeURIComponent(id)}/sample`, 'POST', sample, callback);
  }
  public updateSaved(
    collection: 'presets' | 'quickshots',
    key: string,
    name: string | undefined,
    callback?: CommandCallback
  ) {
    return this.libraryRequest(
      `/library/${collection}/${encodeURIComponent(key)}`,
      'POST',
      { ...(name === undefined ? {} : { name }) },
      callback
    );
  }
  public replaceSaved(
    collection: 'scenes' | 'presets' | 'quickshots',
    key: string,
    name: string | undefined,
    keys: 'all' | string[] | undefined,
    callback?: CommandCallback
  ) {
    return this.libraryRequest(
      `/library/${collection}/${encodeURIComponent(key)}`,
      'POST',
      { ...(name === undefined ? {} : { name }), ...(keys === undefined ? {} : { keys }) },
      callback
    );
  }
  public saveSaved(
    collection: 'scenes' | 'presets' | 'quickshots',
    name: string,
    keys: 'all' | string[] | undefined,
    callback?: CommandCallback
  ) {
    return this.libraryRequest(
      `/library/${collection}`,
      'POST',
      { name, ...(keys === undefined ? {} : { keys }) },
      callback
    );
  }
  public getSaved(collection: 'scenes' | 'presets' | 'quickshots', key: string, callback?: CommandCallback) {
    return this.libraryRequest(`/library/${collection}/${encodeURIComponent(key)}`, 'GET', undefined, callback);
  }
  public transition(
    targets: 'all' | string[],
    action: string,
    args: Record<string, unknown>,
    seconds: number,
    callback?: CommandCallback
  ) {
    return this.runCommand('/transition', { targets, action, args, seconds }, callback);
  }
  public transitionScene(key: string, seconds: number, callback?: CommandCallback) {
    return this.recallSaved('scenes', key, { seconds }, callback);
  }
  public recallSaved(
    collection: 'scenes' | 'presets' | 'quickshots',
    key: string,
    options: { target?: string; seconds?: number },
    callback?: CommandCallback
  ) {
    return this.runCommand(`/library/${collection}/${encodeURIComponent(key)}/recall`, options, callback);
  }

  public async setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback) {
    await this.postEachLightCommand('cct', this.cctBody(cct, intensity), callback);
  }

  public setHSI(
    nodeId: string,
    hue: number,
    sat: number,
    intensity: number,
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ) {
    if (cct !== undefined || gm !== undefined) {
      callback?.(false, 'The 150c supports basic HSI, not advanced HSI CCT/G/M adjustments');
      return;
    }
    return this.postLightCommand(
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
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ) {
    if (cct !== undefined || gm !== undefined) {
      callback?.(false, 'The 150c supports basic HSI, not advanced HSI CCT/G/M adjustments');
      return;
    }
    await this.postEachLightCommand(
      'hsi',
      { brightness: this.apiIntensityToPercent(intensity), hue, saturation: sat },
      callback
    );
  }

  public async getNodeConfig(nodeId: string, callback?: CommandCallback) {
    const device = this.devices.find((entry) => entry.node_id === nodeId || entry.id === nodeId);
    if (!device) {
      callback?.(false, `Device "${nodeId}" not found`);
      return;
    }
    const capabilities = typeof device.capabilities === 'object' && device.capabilities ? device.capabilities : {};
    if (this.features.state) {
      await this.readState(
        nodeId,
        (success, message, state) => {
          callback?.(
            success,
            message,
            success ? { data: { ...device, ...capabilities, ...z.record(z.unknown()).parse(state) } } : undefined
          );
        },
        true
      );
    } else {
      callback?.(true, 'OK', { data: { ...device, ...capabilities } });
    }
  }

  public getSceneList(callback?: CommandCallback) {
    return this.libraryRequest('/library/scenes', 'GET', undefined, callback);
  }

  public getLightSleepStatus(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public getIntensity(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public getCCT(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public getHSI(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public async toggleAllLights(callback?: CommandCallback) {
    if (!this.features.toggle) {
      this.unsupported(callback);
      return;
    }
    await this.postEachLightCommand('toggle', {}, callback);
  }

  public toggleLight(nodeId: string, callback?: CommandCallback) {
    if (!this.features.toggle) {
      this.unsupported(callback);
      return;
    }
    return this.postLightCommand(nodeId, 'toggle', {}, callback);
  }

  public incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'increment-brightness', { delta: delta / 10 }, callback);
  }

  public async incrementIntensityForAllLights(delta: number, callback?: CommandCallback) {
    await this.postEachLightCommand('increment-brightness', { delta: delta / 10 }, callback);
  }

  public incrementCCT(nodeId: string, delta: number, intensity?: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'increment-cct', { delta, ...this.optionalBrightness(intensity) }, callback);
  }

  public async incrementCCTForAllLights(delta: number, intensity?: number, callback?: CommandCallback) {
    await this.postEachLightCommand('increment-cct', { delta, ...this.optionalBrightness(intensity) }, callback);
  }

  public setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'color', { color, ...this.optionalBrightness(intensity) }, callback);
  }

  public async setColorForAllLights(color: string, intensity?: number, callback?: CommandCallback) {
    await this.postEachLightCommand('color', { color, ...this.optionalBrightness(intensity) }, callback);
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

  public getSystemEffect(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public getSystemEffectList(callback?: CommandCallback) {
    return this.libraryRequest('/effects', 'GET', undefined, callback);
  }

  public setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback) {
    return this.postLightCommand(
      nodeId,
      'effect',
      { name: effectType, ...this.optionalBrightness(intensity) },
      callback
    );
  }

  public async setSystemEffectForAllLights(effectType: string, intensity?: number, callback?: CommandCallback) {
    await this.postEachLightCommand('effect', { name: effectType, ...this.optionalBrightness(intensity) }, callback);
  }

  public getEffect(nodeId: string, callback?: CommandCallback) {
    return this.readState(nodeId, callback);
  }

  public setEffect(nodeId: string, effectName: string, args?: CommandArgs, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'effect', { ...args, name: effectName }, callback);
  }

  public setEffectSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'effect-speed', { value: speed }, callback);
  }

  public setEffectAnimationSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'effect-animation-speed', { value: speed }, callback);
  }

  public setEffectIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    return this.postLightCommand(
      nodeId,
      'effect-intensity',
      { value: this.apiIntensityToPercent(intensity) },
      callback
    );
  }

  public getFanMode(nodeId: string, callback?: CommandCallback) {
    return this.fanValue(nodeId, 'mode', callback);
  }

  public async getFanInfo(nodeId: string, callback?: CommandCallback): Promise<void> {
    if (nodeId.startsWith('group:')) return this.fanStates([nodeId], undefined, callback);
    if (!this.features.fan) {
      this.unsupported(callback);
      return;
    }
    try {
      const response = await this.request<BleCommandResponse>(`/lights/${encodeURIComponent(nodeId)}/fan`, {
        method: 'GET',
      });
      if (response.ok !== true) throw new Error(response.error || 'BLE fan query failed');
      const state = FanStateSchema.parse(response.result);
      callback?.(true, 'OK', state);
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  public setFanMode(nodeId: string, mode: number, callback?: CommandCallback) {
    if (nodeId.startsWith('group:')) return this.fanStates([nodeId], mode, callback);
    return this.postLightCommand(nodeId, 'fan', { mode }, callback);
  }

  public async fanStates(
    targets: 'all' | string[],
    mode?: string | number,
    callback?: CommandCallback,
    rpm?: number
  ): Promise<void> {
    try {
      if (mode === undefined && rpm !== undefined) throw new Error('RPM requires manual fan mode');
      if (mode !== undefined) validateFanRpm(parseFanMode(mode), rpm);
    } catch (error) {
      callback?.(false, (error as Error).message);
      return;
    }
    if (rpm !== undefined && !this.features.fanManualRpm) {
      callback?.(false, 'Manual RPM control requires the updated BLE daemon');
      return;
    }
    if (!this.features.fanTargets) {
      if (targets !== 'all' && targets.length === 1 && !targets[0].startsWith('group:')) {
        const wrap: CommandCallback = (ok, message, state) => {
          if (!ok) {
            callback?.(false, message);
            return;
          }
          const parsed = FanStateSchema.safeParse(state);
          if (!parsed.success) {
            callback?.(false, parsed.error.message);
            return;
          }
          callback?.(true, message, { states: { [targets[0]]: parsed.data } });
        };
        if (mode !== undefined) {
          await this.postLightCommand(targets[0], 'fan', { mode, ...(rpm === undefined ? {} : { rpm }) }, wrap);
        } else {
          await this.getFanInfo(targets[0], wrap);
        }
      } else callback?.(false, 'Fan group/all control requires the updated BLE daemon');
      return;
    }
    const response = await this.executeCommand('/fans', {
      targets,
      ...(mode === undefined ? {} : { mode }),
      ...(rpm === undefined ? {} : { rpm }),
    });
    if (!response.success) {
      callback?.(false, response.message);
      return;
    }
    const parsed = FanStatesSchema.safeParse(response.data);
    if (!parsed.success) {
      callback?.(false, parsed.error.message);
      return;
    }
    callback?.(true, 'OK', parsed.data);
  }

  public getFanSpeed(nodeId: string, callback?: CommandCallback) {
    return this.fanValue(nodeId, 'speed', callback);
  }

  public setFanSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    return this.fanStates([nodeId], 'manual', callback, speed);
  }

  public getPresetList(callback?: CommandCallback) {
    return this.libraryRequest('/library/presets', 'GET', undefined, callback);
  }

  public recallPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    return this.recallSaved('presets', presetId, { target: nodeId }, callback);
  }

  public setPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    return this.recallPreset(nodeId, presetId, callback);
  }

  public getQuickshotList(callback?: CommandCallback) {
    return this.libraryRequest('/library/quickshots', 'GET', undefined, callback);
  }

  public setQuickshot(quickshotId: string, callback?: CommandCallback) {
    return this.recallSaved('quickshots', quickshotId, {}, callback);
  }

  public saveScene(name: string, callback?: CommandCallback) {
    return this.libraryRequest('/library/scenes', 'POST', { name }, callback);
  }

  public deleteScene(sceneId: string, callback?: CommandCallback) {
    return this.libraryRequest(`/library/scenes/${encodeURIComponent(sceneId)}`, 'DELETE', undefined, callback);
  }

  public recallScene(sceneId: string, callback?: CommandCallback) {
    return this.runCommand(`/library/scenes/${encodeURIComponent(sceneId)}/recall`, {}, callback);
  }

  public updateScene(sceneId: string, name?: string, callback?: CommandCallback) {
    return this.libraryRequest(`/library/scenes/${encodeURIComponent(sceneId)}`, 'POST', { name }, callback);
  }

  public getGroupList(callback?: CommandCallback) {
    return this.libraryRequest('/groups', 'GET', undefined, callback);
  }

  public createGroup(name: string, callback?: CommandCallback) {
    return this.libraryRequest('/groups', 'POST', { name }, callback);
  }

  public deleteGroup(groupId: string, callback?: CommandCallback) {
    return this.libraryRequest(`/groups/${encodeURIComponent(groupId)}`, 'DELETE', undefined, callback);
  }

  public addToGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    return this.libraryRequest(`/groups/${encodeURIComponent(groupId)}/members`, 'POST', { member: nodeId }, callback);
  }

  public removeFromGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    return this.libraryRequest(
      `/groups/${encodeURIComponent(groupId)}/members`,
      'POST',
      { member: nodeId, remove: true },
      callback
    );
  }

  public setGM(nodeId: string, value: number, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'gm', { value }, callback);
  }

  public stopEffect(nodeId: string, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'effect-stop', {}, callback);
  }
  public triggerEffect(nodeId: string, callback?: CommandCallback) {
    return this.postLightCommand(nodeId, 'effect-trigger', {}, callback);
  }

  public batch(
    targets: string[] | 'all',
    action: string,
    args: Record<string, unknown>,
    broadcast: boolean,
    callback?: CommandCallback
  ) {
    return this.runCommand('/batch', { targets, action, args, broadcast }, callback);
  }

  public fade(targets: string[] | 'all', brightness: number, seconds: number, callback?: CommandCallback) {
    return this.runCommand('/fade', { targets, brightness, seconds }, callback);
  }

  public savePreset(nodeId: string, name: string, callback?: CommandCallback) {
    return this.libraryRequest('/library/presets', 'POST', { name, keys: [nodeId] }, callback);
  }

  public saveQuickshot(name: string, callback?: CommandCallback) {
    return this.libraryRequest('/library/quickshots', 'POST', { name }, callback);
  }

  public deleteSaved(collection: 'presets' | 'quickshots', key: string, callback?: CommandCallback) {
    return this.libraryRequest(`/library/${collection}/${encodeURIComponent(key)}`, 'DELETE', undefined, callback);
  }

  public getDeviceInfo(nodeId: string, callback?: CommandCallback) {
    this.getNodeConfig(nodeId, callback);
  }

  public updateFirmware(_nodeId: string, callback?: CommandCallback) {
    this.unsupported(callback);
  }

  private async refreshDevices(): Promise<void> {
    const response = await this.request<BleLightsResponse>('/', { method: 'GET' });
    if (response.ok !== true) {
      throw new Error(response.error || 'BLE backend returned an error');
    }
    const lights = z
      .array(
        z
          .object({
            key: z.string().min(1),
            name: z.string().min(1),
            mac: z.string().optional(),
            address: z.number().optional(),
            model: z.string().optional(),
            capabilities: z.record(z.unknown()).optional(),
          })
          .passthrough()
      )
      .parse(response.lights);
    this.features = z.record(z.boolean()).parse(response.features ?? {});
    this.devices = lights.map((light) => ({
      ...light,
      id: light.key,
      node_id: light.key,
      device_name: light.name,
      name: light.name,
      device_type: 'ble-light',
      backend: 'ble',
    }));
    const groups = z
      .array(z.object({ id: z.string(), name: z.string(), members: z.array(z.string()) }))
      .parse(response.groups ?? []);
    this.devices.push(
      ...groups.map((group) => ({
        ...group,
        node_id: group.id,
        device_name: group.name,
        device_type: 'ble-group',
        backend: 'ble',
      }))
    );
  }

  private async postLightCommand(
    nodeId: string,
    command: string,
    body?: Record<string, unknown>,
    callback?: CommandCallback
  ): Promise<void> {
    if (!this.supportsCommand(command)) {
      this.unsupported(callback);
      return;
    }
    await this.runCommand(`/lights/${encodeURIComponent(nodeId)}/${command}`, body ?? {}, callback);
  }

  private async postEachLightCommand(
    command: string,
    body: Record<string, unknown>,
    callback?: CommandCallback
  ): Promise<void> {
    if (!this.supportsCommand(command)) {
      this.unsupported(callback);
      return;
    }
    if (this.features.batch && command !== 'toggle') {
      await this.batch('all', command, body, false, callback);
      return;
    }
    const targets = this.devices.flatMap((device) => {
      if (device.device_type === 'ble-group') return [];
      const nodeId =
        typeof device.node_id === 'string' ? device.node_id : typeof device.id === 'string' ? device.id : undefined;
      if (!nodeId) return [];
      return [
        {
          nodeId,
          name: String(device.device_name || device.name || device.id || device.node_id || 'Unknown'),
        },
      ];
    });

    if (targets.length === 0) {
      callback?.(false, 'No BLE lights available');
      return;
    }

    const failures: string[] = [];
    for (const target of targets) {
      const result = await this.executeCommand(`/lights/${encodeURIComponent(target.nodeId)}/${command}`, body);
      if (!result.success) {
        failures.push(`${String(target.name)}: ${result.message}`);
      }
    }

    if (failures.length > 0) {
      callback?.(false, failures.join('; '));
      return;
    }
    callback?.(true, 'OK');
  }

  private async runCommand(path: string, body: Record<string, unknown>, callback?: CommandCallback): Promise<void> {
    const result = await this.executeCommand(path, body);
    callback?.(result.success, result.message, result.data);
  }

  private async libraryRequest(
    path: string,
    method: string,
    body: Record<string, unknown> | undefined,
    callback?: CommandCallback
  ): Promise<void> {
    const feature = path.startsWith('/programs')
      ? 'programs'
      : path === '/desktop/import'
        ? 'desktopImport'
        : path.startsWith('/mesh/')
          ? 'meshConfig'
          : path === '/effects'
            ? 'effects'
            : path === '/overrides'
              ? 'automaticCct'
              : path.startsWith('/lights/') && path.endsWith('/info')
                ? 'productInfo'
                : 'library';
    if (!this.features[feature]) {
      this.unsupported(callback);
      return;
    }
    try {
      const response = await this.request<BleCommandResponse>(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.ok !== true) throw new Error(response.error || 'BLE library operation failed');
      callback?.(true, 'OK', { data: response.result });
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  private async fanValue(nodeId: string, field: 'mode' | 'speed', callback?: CommandCallback): Promise<void> {
    if (nodeId.startsWith('group:')) {
      callback?.(false, 'A group has separate fan states; use fan info for per-fixture telemetry');
      return;
    }
    if (!this.features.fan) {
      this.unsupported(callback);
      return;
    }
    try {
      const response = await this.request<BleCommandResponse>(`/lights/${encodeURIComponent(nodeId)}/fan`, {
        method: 'GET',
      });
      if (response.ok !== true) throw new Error(response.error || 'BLE fan query failed');
      const state = FanStateSchema.parse(response.result);
      callback?.(true, 'OK', state[field]);
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  private async executeCommand(
    path: string,
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    const feature =
      path === '/transition'
        ? 'transitions'
        : path === '/batch'
          ? 'batch'
          : path === '/fade'
            ? 'fade'
            : path === '/fans'
              ? 'fanTargets'
              : path.startsWith('/library/')
                ? 'library'
                : undefined;
    if (feature && !this.features[feature]) return { success: false, message: UNSUPPORTED_MESSAGE };
    try {
      const response = await this.request<BleCommandResponse>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (response.ok !== true) {
        return { success: false, message: response.error || 'BLE backend returned an error' };
      }
      if (this.features.verifiedCommands && response.verified !== true) {
        return { success: false, message: 'BLE daemon did not verify this command' };
      }
      return { success: true, message: 'OK', data: response.result };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, headers, signal: controller.signal });
      const raw = await response.text();
      const data = this.parseResponseBody<T>(
        response.status === 204 && !raw ? '{"ok":true}' : raw,
        response.status,
        url
      );
      if (!response.ok) throw new Error(data.error || `BLE backend HTTP ${response.status}`);
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`BLE backend request timed out after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
      }
      if (error instanceof TypeError) throw new Error(this.formatRequestError(url, error));
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatRequestError(url: string, error: unknown): string {
    if (error instanceof Error) {
      if (error instanceof TypeError && error.message === 'fetch failed') {
        return `Unable to reach BLE backend at ${url}. Make sure the BLE service is running.`;
      }
      return `Unable to reach BLE backend at ${url}: ${error.message}`;
    }
    return `Unable to reach BLE backend at ${url}`;
  }

  private parseResponseBody<T>(raw: string, status: number, url: string): T & { error?: string } {
    if (!raw) {
      throw new Error(`Empty JSON response from BLE backend (${status}) at ${url}`);
    }
    try {
      return JSON.parse(raw) as T & { error?: string };
    } catch (error) {
      throw new Error(`Invalid JSON response from BLE backend (${status}) at ${url}: ${(error as Error).message}`);
    }
  }

  private cctBody(cct: number, intensity?: number): Record<string, unknown> {
    return {
      kelvin: cct,
      ...(intensity !== undefined ? { brightness: this.apiIntensityToPercent(intensity) } : {}),
    };
  }

  private optionalBrightness(intensity?: number): Record<string, number> {
    return intensity === undefined ? {} : { brightness: this.apiIntensityToPercent(intensity) };
  }

  private supportsCommand(command: string): boolean {
    const feature: Record<string, string> = {
      gm: 'gm',
      fan: 'fan',
      color: 'color',
      effect: 'effects',
      'effect-speed': 'effects',
      'effect-animation-speed': 'effects',
      'effect-intensity': 'effects',
      'effect-stop': 'effects',
      'effect-trigger': 'effectTrigger',
      'increment-cct': 'relative',
      'increment-brightness': 'relative',
    };
    return !Object.hasOwn(feature, command) || this.features[feature[command]] === true;
  }

  private apiIntensityToPercent(intensity: number): number {
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1000)
      throw new Error('Intensity must be between 0 and 1000');
    return intensity / 10;
  }

  private stateRecord(value: unknown): Record<string, unknown> {
    const state = z
      .object({
        sleep: z.boolean(),
        intensity: z.number().min(0).max(1000),
        mode: z.enum(['cct', 'hsi', 'effect']),
        cct: z.number().optional(),
        gm: z.number().optional(),
        hue: z.number().optional(),
        sat: z.number().optional(),
        effect: z.string().optional(),
        frequency: z.number().optional(),
        speed: z.number().optional(),
        palette: z.number().optional(),
        observedAt: z.string(),
      })
      .parse(value);
    return { ...state, work_mode: state.mode, effect_type: state.effect, effect_name: state.effect };
  }

  private async readState(nodeId: string, callback?: CommandCallback, allowGroup = false): Promise<void> {
    if (!this.features.state) {
      callback?.(false, 'State readback is not available from this BLE daemon');
      return;
    }
    const group = this.devices.find((device) => device.node_id === nodeId)?.device_type === 'ble-group';
    if (group && !allowGroup) {
      callback?.(false, 'A group has separate fixture states; use status <group> to inspect its members');
      return;
    }
    try {
      const response = await this.request<BleCommandResponse>(`/lights/${encodeURIComponent(nodeId)}/state`, {
        method: 'GET',
      });
      if (response.ok !== true) throw new Error(response.error || 'BLE state query failed');
      if (group) {
        const members = Object.fromEntries(
          Object.entries(z.record(z.unknown()).parse(response.result)).map(([key, value]) => {
            const device = this.devices.find((entry) => entry.node_id === key);
            const caps = z.record(z.unknown()).parse(device?.capabilities ?? {});
            return [key, { ...caps, ...this.stateRecord(value) }];
          })
        );
        callback?.(true, 'OK', { work_mode: 'group', member_states: members });
      } else callback?.(true, 'OK', this.stateRecord(response.result));
    } catch (error) {
      callback?.(false, (error as Error).message);
    }
  }

  private unsupported(callback?: CommandCallback) {
    callback?.(false, UNSUPPORTED_MESSAGE);
  }
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
}
