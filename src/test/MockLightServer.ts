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
        this.nodeConfigs.set(device.node_id, {
          product_cct_min: 2700,
          product_cct_max: 6500,
        });
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
      request: { type: string; node_id?: string };
      data?: unknown;
      node_id?: string;
    } = {
      code: 0,
      message: 'OK',
      request: { type: cmd.type, node_id: cmd.node_id },
      node_id: cmd.node_id,
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
          case 'increase_intensity':
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
          case 'increase_cct':
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
          case 'set_rgb':
            if (cmd.args?.r !== undefined) state.r = cmd.args.r;
            if (cmd.args?.g !== undefined) state.g = cmd.args.g;
            if (cmd.args?.b !== undefined) state.b = cmd.args.b;
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            state.work_mode = 'RGB';
            break;
          case 'set_xy':
            if (cmd.args?.x !== undefined) state.x = cmd.args.x;
            if (cmd.args?.y !== undefined) state.y = cmd.args.y;
            if (cmd.args?.intensity !== undefined) state.intensity = cmd.args.intensity;
            state.work_mode = 'XY';
            break;
          case 'set_fan_mode':
            if (cmd.args?.mode !== undefined) state.fan_mode = cmd.args.mode;
            break;
          case 'set_fan_speed':
            if (cmd.args?.speed !== undefined) state.fan_speed = cmd.args.speed;
            break;
          case 'set_effect_speed':
            if (cmd.args?.speed !== undefined) state.effect_speed = cmd.args.speed;
            break;
          case 'set_effect_intensity':
            if (cmd.args?.intensity !== undefined) state.effect_intensity = cmd.args.intensity;
            break;
          case 'set_system_effect':
            if (cmd.args?.effect_type !== undefined) state.effect_type = cmd.args.effect_type;
            state.work_mode = 'EFFECT';
            break;
          case 'set_effect':
            if (cmd.args?.name !== undefined) state.effect_name = cmd.args.name;
            state.work_mode = 'CUSTOM_EFFECT';
            break;
        }
      }
    }

    // Generate response data
    switch (cmd.type) {
      case 'get_device_list':
      case 'get_fixture_list':
        response.data = { data: this.devices };
        break;

      case 'get_device_info':
        response.data = { model: 'Mock LED', version: '1.0.0' };
        break;
      case 'get_firmware_version':
        response.data = { version: '1.0.0' };
        break;
      case 'check_for_updates':
        response.data = { update_available: false };
        break;
      case 'update_firmware':
        response.data = { status: 'updating' };
        break;
      case 'get_scene_list':
        response.data = { data: [] };
        break;
      case 'save_scene':
      case 'delete_scene':
      case 'recall_scene':
      case 'update_scene':
        response.data = { id: 'scene-123' };
        break;
      case 'get_preset_list':
        response.data = { data: { cct: [], color: [], effect: [] } };
        break;
      case 'recall_preset':
      case 'set_preset':
        response.data = { id: cmd.args?.preset_id || cmd.args?.id || 'preset-123' };
        break;
      case 'get_system_effect_list':
        response.data = { data: ['fire', 'lightning'] };
        break;
      case 'get_quickshot_list':
        response.data = { data: [{ id: 'qs-123', name: 'Quickshot 1' }] };
        break;
      case 'set_quickshot':
        response.data = cmd.args?.quickshot_id;
        break;
      case 'get_group_list':
        response.data = { data: [] };
        break;
      case 'create_group':
        response.data = { id: 'group-123', name: cmd.args?.name };
        break;
      case 'delete_group':
        response.data = { id: cmd.args?.id };
        break;
      case 'add_to_group':
      case 'remove_from_group':
        response.data = { group_id: cmd.args?.group_id, node_id: cmd.args?.node_id };
        break;
      case 'get_node_config': {
        const config = this.nodeConfigs.get(cmd.node_id || '') || { config: 'mock' };
        const state = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
        response.data = {
          node_id: cmd.node_id,
          data: { ...config, ...state },
        };
        response.node_id = cmd.node_id;
        break;
      }
      case 'get_sleep':
        if (cmd.node_id && this.deviceStates.has(cmd.node_id)) {
          response.data = { sleep: this.deviceStates.get(cmd.node_id)?.sleep };
        }
        break;
      case 'get_intensity':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id)?.intensity : 0;
        break;
      case 'get_cct':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
        break;
      case 'get_hsi':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
        break;
      case 'get_rgb':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
        break;
      case 'get_xy':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id) : {};
        break;
      case 'get_fan_mode':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id)?.fan_mode : 0;
        break;
      case 'get_fan_speed':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id)?.fan_speed : 0;
        break;
      case 'get_system_effect':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id)?.effect_type : '';
        break;
      case 'get_effect':
        response.data = cmd.node_id ? this.deviceStates.get(cmd.node_id)?.effect_name : '';
        break;
      default:
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
