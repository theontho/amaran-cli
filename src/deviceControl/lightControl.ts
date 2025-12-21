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

      const requestId = parsedData.request?.type;
      if (parsedData.code !== 0) {
        console.error('Error from server:', parsedData.message);
        if (requestId && this.commandCallbacks.has(requestId)) {
          this.commandCallbacks.get(requestId)?.(false, parsedData.message);
          this.commandCallbacks.delete(requestId);
        }
        return;
      }

      if (requestId && this.commandCallbacks.has(requestId)) {
        this.commandCallbacks.get(requestId)?.(true, parsedData.message, parsedData.data);
        this.commandCallbacks.delete(requestId);
      }

      if (parsedData.request?.type) {
        this.processResponseType(parsedData.request.type, parsedData.data);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  // biome-ignore lint/suspicious/noExplicitAny: Dynamic data from server needs flexible typing before validation
  private processResponseType(type: string, data: any) {
    switch (type) {
      case 'get_device_list':
        this.handleDeviceList(data);
        break;
      case 'get_scene_list':
        this.handleSceneList(data);
        break;
      case 'get_node_config':
        this.handleNodeConfig(data);
        break;
      default:
        this.log('Unknown response type:', type);
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

  private handleNodeConfig(data: { node_id?: string; data: NodeConfig }) {
    const nodeId = data.node_id;
    if (nodeId) {
      this.nodeConfigs.set(nodeId, data.data);
      this.log('Node Config:', JSON.stringify(data.data, null, 2));

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

  public getDeviceList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_device_list', {}, callback);
  }

  public getSceneList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_scene_list', {}, callback);
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

  public setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_intensity', { intensity }, callback);
  }

  public incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'increment_intensity', { delta }, callback);
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
    this.sendCommand(nodeId, 'increment_cct', args, callback);
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

  public setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { color };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_color', args, callback);
  }

  public setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { effect_type: effectType };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_system_effect', args, callback);
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
        node_id: nodeId,
        args,
      };

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
