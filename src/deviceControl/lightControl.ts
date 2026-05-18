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
import { LightControllerCommands } from './lightControlCommands.js';
import type { Command, CommandArgs, CommandCallback, CommandType, Device, NodeConfig } from './types.js';

const LIGHT_NODE_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+$/i;

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
class LightController extends LightControllerCommands {
  private ws: WebSocket;
  private clientId: string = 'unknown_client';
  private deviceList: Device[] = [];
  private sceneList: unknown[] = [];
  private nodeConfigs: Map<string, NodeConfig> = new Map();
  private commandCallbacks: Map<string, CommandCallback[]> = new Map();
  private pendingQueue: PendingCommand[] = [];
  private onInitializedCallback?: () => void;
  private debug: boolean = false;

  constructor(wsUrl: string, clientId?: string, onInitialized?: () => void, debug = false) {
    super();
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
      const nodeId = parsedData.node_id || parsedData.request?.node_id || parsedData.data?.node_id;

      let callback: CommandCallback | undefined;
      let usedKey: string | undefined;

      if (action && nodeId) {
        const key = `${action}_${nodeId}`;
        if (this.commandCallbacks.has(key)) {
          callback = this.commandCallbacks.get(key)?.[0];
          usedKey = key;
        }
      }

      if (!callback && action && this.commandCallbacks.has(action)) {
        callback = this.commandCallbacks.get(action)?.[0];
        usedKey = action;
      }

      if (parsedData.code !== 0) {
        console.error('Error from server:', parsedData.message);
        if (callback && usedKey) {
          this.popCommandCallback(usedKey)?.(false, parsedData.message);
        }
        return;
      }

      if (callback && usedKey) {
        this.popCommandCallback(usedKey)?.(true, parsedData.message, parsedData.data);
      }

      if (action) {
        this.processResponseType(action, parsedData.data, nodeId);
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

      // Normalize CCT range keys from Amaran API
      if (config && typeof config === 'object') {
        if (config.product_cct_min !== undefined && config.cct_min === undefined) {
          config.cct_min = config.product_cct_min;
        }
        if (config.product_cct_max !== undefined && config.cct_max === undefined) {
          config.cct_max = config.product_cct_max;
        }
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

  protected sendCommand(nodeId: string | undefined, type: CommandType, args?: CommandArgs, callback?: CommandCallback) {
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
        const callbackKey = nodeId ? `${type}_${nodeId}` : type;
        const callbacks = this.commandCallbacks.get(callbackKey) ?? [];
        callbacks.push(callback);
        this.commandCallbacks.set(callbackKey, callbacks);
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

  private popCommandCallback(key: string): CommandCallback | undefined {
    const callbacks = this.commandCallbacks.get(key);
    if (!callbacks || callbacks.length === 0) return undefined;

    const callback = callbacks.shift();
    if (callbacks.length === 0) {
      this.commandCallbacks.delete(key);
    }
    return callback;
  }

  protected isLightNodeId(nodeId: string): boolean {
    return LIGHT_NODE_PATTERN.test(nodeId);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected log(...args: unknown[]) {
    if (this.debug) {
      console.log(...args);
    }
  }

  protected getLightControlDevices(): Device[] {
    return this.deviceList;
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
