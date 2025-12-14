import { type WebSocket, WebSocketServer } from 'ws';

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

interface Command {
  version: number;
  client_id: string;
  type: string;
  node_id?: string;
  args?: Record<string, unknown>;
}

export class MockLightServer {
  private wss: WebSocketServer;
  private devices: Device[] = [
    { node_id: '400J5-F2C008', device_name: 'Test Light 1' },
    { node_id: '400J5-F2C009', device_name: 'Test Light 2' },
  ];
  private nodeConfigs: Map<string, NodeConfig> = new Map();
  // Store state for each device
  private deviceStates: Map<string, Record<string, unknown>> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.initializeState();

    this.wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        try {
          const cmd = JSON.parse(message.toString()) as Command;
          this.handleCommand(ws, cmd);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });
    });
  }

  private initializeState() {
    this.devices.forEach((device) => {
      if (device.node_id) {
        this.deviceStates.set(device.node_id, {
          sleep: false,
          intensity: 0,
          cct: 3200,
          hue: 0,
          sat: 0,
          work_mode: 'CCT',
        });
        this.nodeConfigs.set(device.node_id, { config: 'mock' });
      }
    });
  }

  public resetState() {
    this.initializeState();
  }

  private handleCommand(ws: WebSocket, cmd: Command) {
    const response: {
      code: number;
      message: string;
      request: { type: string };
      data?: unknown;
      node_id?: string;
    } = {
      code: 0,
      message: 'OK',
      request: { type: cmd.type },
    };

    // Update state based on commands
    if (cmd.node_id && this.deviceStates.has(cmd.node_id)) {
      const state = this.deviceStates.get(cmd.node_id);
      if (state) {
        switch (cmd.type) {
          case 'set_sleep':
            if (cmd.args?.sleep !== undefined) state.sleep = cmd.args.sleep;
            break;
          case 'toggle_sleep':
            state.sleep = !state.sleep;
            break;
          case 'set_intensity':
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            break;
          case 'increment_intensity':
            if (typeof cmd.args?.delta === 'number') {
              state.intensity = Math.max(0, Math.min(1000, (state.intensity as number) + cmd.args.delta));
            }
            break;
          case 'set_cct':
            if (cmd.args?.cct !== undefined) state.cct = cmd.args.cct;
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            state.work_mode = 'CCT';
            break;
          case 'increment_cct':
            if (typeof cmd.args?.delta === 'number') {
              state.cct = Math.max(2700, Math.min(6500, (state.cct as number) + cmd.args.delta));
            }
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            break;
          case 'set_hsi':
            if (cmd.args?.hue !== undefined) state.hue = cmd.args.hue;
            if (cmd.args?.sat !== undefined) state.sat = cmd.args.sat;
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            state.work_mode = 'HSI';
            break;
        }
      }
    }

    // Generate response data
    switch (cmd.type) {
      case 'get_device_list':
        response.data = { data: this.devices };
        break;
      case 'get_scene_list':
        response.data = { data: [] };
        break;
      case 'get_node_config': {
        {
          const config = this.nodeConfigs.get(cmd.node_id || '') || { config: 'mock' };
          const state = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
          response.data = {
            node_id: cmd.node_id,
            data: { ...config, ...state },
          };
          // The real server includes node_id at the top level for this response
          response.node_id = cmd.node_id;
          break;
        }
      }
      case 'get_sleep':
        if (cmd.node_id && this.deviceStates.has(cmd.node_id)) {
          response.data = { sleep: this.deviceStates.get(cmd.node_id)?.sleep };
        }
        break;
      default:
        // For set commands, we usually don't send back data, just OK
        response.data = {};
    }

    ws.send(JSON.stringify(response));
  }

  close(callback?: (err?: Error) => void) {
    this.wss.clients.forEach((client) => {
      client.terminate();
    });
    this.wss.close(callback);
  }

  // Helper to check state in tests
  getDeviceState(nodeId: string) {
    return this.deviceStates.get(nodeId);
  }
}
