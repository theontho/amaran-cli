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
import { DEVICE_DEFAULTS } from './constants';

// The commands are probably 1:1 with the OpenAPI commands listed here:
// https://tools.sidus.link/openapi/docs/usage
type CommandType =
  | 'get_device_list'
  | 'get_scene_list'
  | 'get_node_config'
  | 'get_sleep'
  | 'get_preset_list'
  | 'get_system_effect_list'
  | 'set_sleep'
  | 'toggle_sleep'
  | 'set_intensity'
  | 'increment_intensity'
  | 'set_cct'
  | 'increment_cct'
  | 'set_hsi'
  | 'set_color'
  | 'set_system_effect';

interface Device {
  node_id?: string;
  device_name?: string;
  name?: string;
  id?: string;
  [key: string]: unknown;
}

interface NodeConfig {
  [key: string]: unknown;
}

interface CommandArgs {
  [key: string]: unknown;
}

interface Command {
  version: number;
  client_id: string;
  type: CommandType;
  node_id?: string;
  args?: CommandArgs;
}

type CommandCallback = (success: boolean, message: string, data?: unknown) => void;

class LightController {
  /**
   * Apply a command to all light devices with throttling.
   * Only targets devices with node_ids matching the light pattern (e.g., '400J5-F2C008').
   * Throttles commands with ${DEVICE_DEFAULTS.commandThrottleDelay}ms delay between each to avoid overwhelming the server.
   *
   * @param commandFn - Function that takes (nodeId, callback) and executes the command
   * @param commandName - Display name for the command (for logging)
   * @param getDisplayArgs - Optional function to get display arguments for logging
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

      // Filter for light devices (node_ids that look like light IDs)
      const lightDevices = this.deviceList.filter((device) =>
        device.node_id ? this.isLightNodeId(device.node_id) : false
      );

      if (lightDevices.length === 0) {
        this.log('No light devices found');
        return;
      }

      this.log(`${commandName} for ${lightDevices.length} light(s)`);

      const waitTimeMs = DEVICE_DEFAULTS.commandThrottleDelay;
      // Send commands with waitTimeMs throttling between each
      for (let i = 0; i < lightDevices.length; i++) {
        const device = lightDevices[i];
        const displayName = device.device_name || device.name || device.node_id || 'Unknown';
        const displayArgs = getDisplayArgs ? getDisplayArgs(device) : '';

        // Only log if we're not in test environment
        if (process.env.NODE_ENV !== 'test') {
          console.log(`  ${commandName} ${displayName} (${device.node_id})${displayArgs}`);
        }

        if (device.node_id) {
          commandFn(device.node_id);
        }

        // Wait waitTimeMs before sending next command (skip delay after last one)
        if (i < lightDevices.length - 1) {
          await this.sleep(waitTimeMs);
        }
      }
    } catch (error) {
      console.error('Error in applyToAllLights:', error);
      throw error;
    }
  }

  /**
   * Set CCT & Intensity for all lights in deviceList.
   * Only targets devices with node_ids matching the light pattern (e.g., '400J5-F2C008').
   * Throttles commands with ${DEVICE_DEFAULTS.commandThrottleDelay}ms delay between each to avoid overwhelming the server.
   */
  public async setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setCCT(nodeId, cct, intensity, callback),
      'Setting CCT',
      () => ` to ${cct}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  /**
   * Turn on all lights.
   */
  public async turnOnAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOn(nodeId, callback), 'Turning on');
  }

  /**
   * Turn off all lights.
   */
  public async turnOffAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOff(nodeId, callback), 'Turning off');
  }

  /**
   * Toggle all lights.
   */
  public async toggleAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.toggleLight(nodeId, callback), 'Toggling');
  }

  /**
   * Set intensity for all lights.
   */
  public async setIntensityForAllLights(intensity: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setIntensity(nodeId, intensity, callback),
      'Setting intensity',
      () => ` to ${intensity / 10}%`
    );
  }

  /**
   * Increment intensity for all lights.
   */
  public async incrementIntensityForAllLights(delta: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementIntensity(nodeId, delta, callback),
      'Incrementing intensity',
      () => ` by ${delta > 0 ? '+' : ''}${delta / 10}%`
    );
  }

  /**
   * Increment CCT for all lights.
   */
  public async incrementCCTForAllLights(delta: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementCCT(nodeId, delta, intensity, callback),
      'Incrementing CCT',
      () => ` by ${delta > 0 ? '+' : ''}${delta}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  /**
   * Set HSI color for all lights.
   */
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

  /**
   * Set color for all lights.
   */
  public async setColorForAllLights(color: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setColor(nodeId, color, intensity, callback),
      'Setting color',
      () => ` to ${color}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  /**
   * Set system effect for all lights.
   */
  public async setSystemEffectForAllLights(effectType: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setSystemEffect(nodeId, effectType, intensity, callback),
      'Setting effect',
      () => ` to ${effectType}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  /**
   * Check if a node_id looks like a light device (not a group or other entity).
   * Light node_ids typically follow pattern like '400J5-F2C008' (alphanumeric with dash).
   */
  private isLightNodeId(nodeId: string): boolean {
    // Pattern: contains at least one dash and alphanumeric characters
    // Excludes things like 'all', 'group1', etc.
    const lightPattern = /^[A-Z0-9]+-[A-Z0-9]+$/i;
    return lightPattern.test(nodeId);
  }

  /**
   * Sleep utility for throttling commands
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private ws: WebSocket;
  private clientId: string = 'unknown_client';
  private deviceList: Device[] = [];
  private sceneList: unknown[] = [];
  private nodeConfigs: Map<string, NodeConfig> = new Map();
  private debug: boolean;
  private onInitializedCallback?: () => void;
  private commandCallbacks: Map<string, CommandCallback> = new Map();
  private pendingQueue: Array<{
    nodeId?: string;
    type: CommandType;
    args?: CommandArgs;
    callback?: CommandCallback;
  }> = [];

  constructor(wsUrl: string, clientId?: string, onInitialized?: () => void, debug: boolean = false) {
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
      // Flush any queued commands that were issued before the socket was open
      this.flushPending();
      this.onConnectionOpen();
    });

    this.ws.on('message', (data) => {
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
          switch (parsedData.request.type) {
            case 'get_device_list':
              this.handleDeviceList(parsedData.data);
              break;
            case 'get_scene_list':
              this.handleSceneList(parsedData.data);
              break;
            case 'get_node_config':
              this.handleNodeConfig(parsedData.data);
              break;
            default:
              this.log('Unknown response type');
          }
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.ws.on('error', (error) => {
      if (this.debug) {
        console.error('WebSocket error:', error);
      } else {
        // Extract address and port from the error message for cleaner output
        const addressMatch = error.message.match(/(\S+:\d+)/);
        const addressPort = addressMatch ? addressMatch[1] : this.ws.url;
        console.error(chalk.red(`WebSocket connection failed to ${chalk.bold(addressPort)}`));
      }
    });

    this.ws.on('close', () => {
      this.log('Disconnected from WebSocket server');
    });
  }

  // Public getter for WebSocket to allow external error handling
  public getWebSocket(): WebSocket {
    return this.ws;
  }

  setClientId(clientId: string) {
    this.clientId = clientId;
  }

  private onConnectionOpen() {
    this.getDeviceList();
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
      // Queue the command to be sent when the socket opens
      this.pendingQueue.push({ nodeId, type, args, callback });
      this.log(`Queued command (socket not open yet): ${type}`);
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

  getDeviceList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_device_list', {}, callback);
  }

  getSceneList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_scene_list', {}, callback);
  }

  getNodeConfig(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_node_config', {}, callback);
  }

  turnLightOn(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: false }, callback);
  }

  turnLightOff(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: true }, callback);
  }

  getLightSleepStatus(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_sleep', {}, callback);
  }

  toggleLight(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'toggle_sleep', undefined, callback);
  }

  setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_intensity', { intensity }, callback);
  }

  incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'increment_intensity', { delta }, callback);
  }

  setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { cct };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_cct', args, callback);
  }

  incrementCCT(nodeId: string, delta: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { delta };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'increment_cct', args, callback);
  }

  setHSI(
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

  setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { color };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_color', args, callback);
  }

  setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { effect_type: effectType };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_system_effect', args, callback);
  }

  async disconnect() {
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

  // Getters
  public getDevices(): Device[] {
    return this.deviceList;
  }

  public getScenes(): unknown[] {
    return this.sceneList;
  }

  public getNode(nodeId: string) {
    return this.nodeConfigs.get(nodeId);
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
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
}

export default LightController;
