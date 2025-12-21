/*
MIT License
Copyright (c) 2024 S. Zachariah Sprackett <zac@sprackett.com>
Copyright (c) 2025 Mahyar McDonald <github@hmmfn.com>

Control Aputure Amaran Lights via websocket to the amaran Desktop application.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Downloaded from: https://gist.github.com/zsprackett/29334b9be1e2bd90c1737bd0ba0eaf5c 
*/

import chalk from 'chalk';
import WebSocket from 'ws';
import { DEVICE_DEFAULTS } from './constants.js';
import type { Command, CommandArgs, CommandCallback, CommandType, Device, NodeConfig } from './types.js';

interface PendingCommand {
  nodeId: string | undefined;
  type: CommandType;
  args?: CommandArgs;
  callback?: CommandCallback;
}

/**
 * Control Aputure Amaran Lights via websocket to the amaran Desktop application.
 *
 * @class LightController
 */
class LightController {
  private ws: WebSocket;
  private clientId: string = 'unknown_client';
  private deviceList: Device[] = [];
  private sceneList: unknown[] = [];
  private nodeConfigs: Map<string, NodeConfig> = new Map();
  private commandCallbacks: Map<string, CommandCallback> = new Map();
  private pendingQueue: PendingCommand[] = [];
  private onInitializedCallback?: () => void;
  private debug: boolean = false;

  constructor(wsUrl: string, clientId?: string, onInitialized?: () => void, debug = false) {
    this.ws = new WebSocket(wsUrl);
    if (clientId) {
      this.clientId = clientId;
    }
    this.debug = debug;

    if (onInitialized) {
      this.onInitializedCallback = onInitialized;
    }

    this.ws.on('open', () => {
      this.log('Connected to WebSocket server');
      this.flushPending();
      this.onConnectionOpen();
    });

    this.ws.on('message', (data) => this.handleMessage(data));

    this.ws.on('error', (error) => {
      if (this.debug) {
        console.error('WebSocket error:', error);
      } else {
        const addressMatch = error.message.match(/(\S+:\d+)/);
        const addressPort = addressMatch ? addressMatch[1] : this.ws.url;
        console.error(chalk.red(`WebSocket connection failed to ${addressPort}`));
      }
    });

    this.ws.on('close', () => {
      this.log('Disconnected from WebSocket server');
    });
  }

  // --- Initialization & Message Handling ---

  private onConnectionOpen() {
    this.getDeviceList();
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const parsedData = JSON.parse(data.toString());
      this.log('Received message from server:', parsedData);

      const action = parsedData.action || parsedData.request?.type;
      if (parsedData.code !== 0) {
        console.error('Error from server:', parsedData.message);
        if (action && this.commandCallbacks.has(action)) {
          this.commandCallbacks.get(action)?.(false, parsedData.message);
          this.commandCallbacks.delete(action);
        }
        return;
      }

      if (action && this.commandCallbacks.has(action)) {
        this.commandCallbacks.get(action)?.(true, parsedData.message, parsedData.data);
        this.commandCallbacks.delete(action);
      }

      if (action) {
        this.processResponseType(action, parsedData.data, parsedData.node_id);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Dynamic data from server needs flexible typing before validation
  private processResponseType(type: string, data: any, nodeId?: string) {
    switch (type) {
      case 'get_device_list':
      case 'get_fixture_list':
        this.handleDeviceList(data);
        break;
      case 'get_scene_list':
        this.handleSceneList(data);
        break;
      case 'get_node_config':
        this.handleNodeConfig({ node_id: nodeId, data });
        break;
      default:
        this.log('Response type processed:', type);
    }
  }

  private handleDeviceList(data: { data: Device[] }) {
    this.deviceList = data.data;
    this.log('Device List:', JSON.stringify(this.deviceList, null, 2));
    this.getSceneList();
  }

  private handleSceneList(data: { data: unknown[] }) {
    this.sceneList = data.data;
    this.log('Scene List:', JSON.stringify(this.sceneList, null, 2));
    this.getNodeConfigs();
  }

  // biome-ignore lint/suspicious/noExplicitAny: Payload can be flat or nested from different server versions
  private handleNodeConfig(payload: { node_id?: string; data: any }) {
    const nodeId = payload.node_id || payload.data?.node_id;
    if (nodeId) {
      let config = payload.data;
      // If server returned nested data: { node_id, data: { ...config } }
      if (config && typeof config === 'object' && 'data' in config && ('node_id' in config || 'id' in config)) {
        config = config.data;
      }

      this.nodeConfigs.set(nodeId, config);
      this.log('Node Config:', JSON.stringify(config, null, 2));

      if (this.nodeConfigs.size === this.deviceList.length) {
        this.log('All node configurations have been gathered');
        if (this.onInitializedCallback) {
          this.onInitializedCallback();
        }
      }
    }
  }

  private getNodeConfigs() {
    this.deviceList.forEach((device) => {
      if (device.node_id) {
        this.getNodeConfig(device.node_id);
      }
    });
  }

  // --- Convenience Methods (Applied to All Lights) ---

  /**
   * Apply a command to all light devices with throttling.
   */
  private async applyToAllLights(
    commandFn: (nodeId: string, callback?: CommandCallback) => void,
    commandName: string,
    getDisplayArgs?: (device: Device) => string
  ): Promise<void> {
    try {
      if (!this.deviceList || this.deviceList.length === 0) {
        this.log('No devices found');
        return;
      }

      const lightDevices = this.deviceList.filter((device) =>
        device.node_id ? this.isLightNodeId(device.node_id) : false
      );

      if (lightDevices.length === 0) {
        this.log('No light devices found');
        return;
      }

      this.log(`${commandName} for ${lightDevices.length} light(s)`);

      const waitTimeMs = DEVICE_DEFAULTS.commandThrottleDelay;
      for (let i = 0; i < lightDevices.length; i++) {
        const device = lightDevices[i];
        const displayName = device.device_name || device.name || device.node_id || 'Unknown';
        const displayArgs = getDisplayArgs ? getDisplayArgs(device) : '';

        if (process.env.NODE_ENV !== 'test') {
          console.log(`  ${commandName} ${displayName} (${device.node_id})${displayArgs}`);
        }

        if (device.node_id) {
          commandFn(device.node_id);
        }

        if (i < lightDevices.length - 1) {
          await this.sleep(waitTimeMs);
        }
      }
    } catch (error) {
      console.error('Error in applyToAllLights:', error);
      throw error;
    }
  }

  public async setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setCCT(nodeId, cct, intensity, callback),
      'Setting CCT',
      () => ` to ${cct}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public async turnOnAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOn(nodeId, callback), 'Turning on');
  }

  public async turnOffAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOff(nodeId, callback), 'Turning off');
  }

  public async toggleAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.toggleLight(nodeId, callback), 'Toggling');
  }

  public async setIntensityForAllLights(intensity: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setIntensity(nodeId, intensity, callback),
      'Setting intensity',
      () => ` to ${intensity / 10}%`
    );
  }

  public async incrementIntensityForAllLights(delta: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementIntensity(nodeId, delta, callback),
      'Incrementing intensity',
      () => ` by ${delta > 0 ? '+' : ''}${delta / 10}%`
    );
  }

  public async incrementCCTForAllLights(delta: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementCCT(nodeId, delta, intensity, callback),
      'Incrementing CCT',
      () => ` by ${delta > 0 ? '+' : ''}${delta}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
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
    await this.applyToAllLights(
      (nodeId) => this.setHSI(nodeId, hue, sat, intensity, cct, gm, callback),
      'Setting HSI',
      () => ` to H:${hue} S:${sat} I:${intensity / 10}%`
    );
  }

  public async setColorForAllLights(color: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setColor(nodeId, color, intensity, callback),
      'Setting color',
      () => ` to ${color}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public async setSystemEffectForAllLights(effectType: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setSystemEffect(nodeId, effectType, intensity, callback),
      'Setting effect',
      () => ` to ${effectType}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  // --- Individual Light Control Methods ---

  public getProtocolVersions(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_protocol_versions', {}, callback);
  }

  public getFixtureList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_fixture_list', {}, callback);
  }

  public getDeviceList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_device_list', {}, callback);
  }

  public getDeviceInfo(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_device_info', {}, callback);
  }

  public getFirmwareVersion(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_firmware_version', {}, callback);
  }

  public checkForUpdates(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'check_for_updates', {}, callback);
  }

  public updateFirmware(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'update_firmware', {}, callback);
  }

  public getSceneList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_scene_list', {}, callback);
  }

  public saveScene(name: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'save_scene', { name }, callback);
  }

  public deleteScene(sceneId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'delete_scene', { id: sceneId }, callback);
  }

  public recallScene(sceneId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'recall_scene', { id: sceneId }, callback);
  }

  public updateScene(sceneId: string, name?: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'update_scene', { id: sceneId, name }, callback);
  }

  public getPresetList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_preset_list', {}, callback);
  }

  public recallPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'recall_preset', { id: presetId }, callback);
  }

  public setPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_preset', { preset_id: presetId }, callback);
  }

  public getSystemEffectList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_system_effect_list', {}, callback);
  }

  public getQuickshotList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_quickshot_list', {}, callback);
  }

  public setQuickshot(quickshotId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'set_quickshot', { quickshot_id: quickshotId }, callback);
  }

  public getGroupList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_group_list', {}, callback);
  }

  public createGroup(name: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'create_group', { name }, callback);
  }

  public deleteGroup(groupId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'delete_group', { id: groupId }, callback);
  }

  public addToGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'add_to_group', { group_id: groupId, node_id: nodeId }, callback);
  }

  public removeFromGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'remove_from_group', { group_id: groupId, node_id: nodeId }, callback);
  }

  public getNodeConfig(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_node_config', {}, callback);
  }

  public turnLightOn(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: false }, callback);
  }

  public turnLightOff(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: true }, callback);
  }

  public getLightSleepStatus(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_sleep', {}, callback);
  }

  public toggleLight(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'toggle_sleep', undefined, callback);
  }

  public getIntensity(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_intensity', {}, callback);
  }

  public setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_intensity', { intensity }, callback);
  }

  public incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'increase_intensity', { delta }, callback);
  }

  public getCCT(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_cct', {}, callback);
  }

  public setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { cct };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_cct', args, callback);
  }

  public incrementCCT(nodeId: string, delta: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { delta };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'increase_cct', args, callback);
  }

  public getHSI(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_hsi', {}, callback);
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
    const args: CommandArgs = { hue, sat, intensity };
    if (cct !== undefined) {
      args.cct = cct;
    }
    if (gm !== undefined) {
      args.gm = gm;
    }
    this.sendCommand(nodeId, 'set_hsi', args, callback);
  }

  public getRGB(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_rgb', {}, callback);
  }

  public setRGB(nodeId: string, r: number, g: number, b: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { r, g, b };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_rgb', args, callback);
  }

  public getXY(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_xy', {}, callback);
  }

  public setXY(nodeId: string, x: number, y: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { x, y };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_xy', args, callback);
  }

  public setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { color };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_color', args, callback);
  }

  public getSystemEffect(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_system_effect', {}, callback);
  }

  public setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { effect_type: effectType };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_system_effect', args, callback);
  }

  public getEffect(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_effect', {}, callback);
  }

  public setEffect(nodeId: string, effectName: string, args?: CommandArgs, callback?: CommandCallback) {
    const combinedArgs: CommandArgs = { name: effectName, ...args };
    this.sendCommand(nodeId, 'set_effect', combinedArgs, callback);
  }

  public getFanMode(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_fan_mode', {}, callback);
  }

  public setFanMode(nodeId: string, mode: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_fan_mode', { mode }, callback);
  }

  public getFanSpeed(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_fan_speed', {}, callback);
  }

  public setFanSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_fan_speed', { speed }, callback);
  }

  public setEffectSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_effect_speed', { speed }, callback);
  }

  public setEffectIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_effect_intensity', { intensity }, callback);
  }

  // --- Utility & Infrastructure ---

  public async disconnect() {
    if (this.ws.readyState === WebSocket.OPEN) {
      await this.waitForPendingCommands(5000);
      this.ws.close();
      this.log('WebSocket connection closed');
    } else {
      console.error('WebSocket is not open or already closed');
    }
  }

  private waitForPendingCommands(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const start = Date.now();
      const checkPendingCommands = () => {
        if (this.commandCallbacks.size === 0 || Date.now() - start >= timeout) {
          resolve();
        } else {
          setTimeout(checkPendingCommands, 100);
        }
      };
      checkPendingCommands();
    });
  }

  private sendCommand(nodeId: string | undefined, type: CommandType, args?: CommandArgs, callback?: CommandCallback) {
    if (this.ws.readyState === WebSocket.OPEN) {
      const command: Command = {
        version: 1,
        client_id: this.clientId,
        type,
        action: type,
        node_id: nodeId,
        args,
      };

      // biome-ignore lint/suspicious/noExplicitAny: Backward compatibility for mock server
      (command as any).request = { type };

      if (callback) {
        this.commandCallbacks.set(type, callback);
      }

      this.ws.send(JSON.stringify(command));
      this.log(`Sent command: ${type}`);
    } else {
      this.pendingQueue.push({ nodeId, type, args, callback });
      this.log(`Queued command (socket not open yet): ${type}`);
    }
  }

  private flushPending() {
    if (this.pendingQueue.length === 0) return;
    const pending = [...this.pendingQueue];
    this.pendingQueue.length = 0;
    for (const p of pending) {
      this.sendCommand(p.nodeId, p.type, p.args, p.callback);
    }
  }

  private isLightNodeId(nodeId: string): boolean {
    const lightPattern = /^[A-Z0-9]+-[A-Z0-9]+$/i;
    return lightPattern.test(nodeId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  // Getters & Public Utilities
  public getWebSocket(): WebSocket {
    return this.ws;
  }

  public setClientId(clientId: string) {
    this.clientId = clientId;
  }

  public getDevices(): Device[] {
    return this.deviceList;
  }

  public getScenes(): unknown[] {
    return this.sceneList;
  }

  public getNode(nodeId: string) {
    return this.nodeConfigs.get(nodeId);
  }
}

export default LightController;
