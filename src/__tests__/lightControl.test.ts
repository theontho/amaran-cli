import { Server as WebSocketServer } from 'ws';
import LightController from '../lightControl';

const TEST_PORT = 8089;
const WS_URL = `ws://localhost:${TEST_PORT}`;

// Simple mock WebSocket server for LightController
class MockLightServer {
  private wss: WebSocketServer;
  private devices = [
    { node_id: '400J5-F2C008', device_name: 'Test Light 1' },
    { node_id: '400J5-F2C009', device_name: 'Test Light 2' },
  ];
  constructor(port: number) {
    this.wss = new WebSocketServer({ port });
    this.wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        const cmd = JSON.parse(message.toString());
        const response: any = { code: 0, message: 'OK', request: { type: cmd.type } };
        switch (cmd.type) {
          case 'get_device_list':
            response.data = { data: this.devices };
            break;
          case 'get_scene_list':
            response.data = { data: [] };
            break;
          case 'get_node_config':
            response.data = { node_id: cmd.node_id, data: { config: 'mock' } };
            break;
          default:
            response.data = {};
        }
        ws.send(JSON.stringify(response));
      });
    });
  }
  close() {
    this.wss.close();
  }
}

describe('LightController', () => {
  let server: MockLightServer;
  let controller: LightController;

  beforeAll((done) => {
    server = new MockLightServer(TEST_PORT);
    setTimeout(done, 100); // Give server time to start
  });

  afterAll(() => {
    server.close();
  });

  afterEach(async () => {
    if (controller) {
      await controller.disconnect();
    }
  });

  it('should initialize and fetch devices', (done) => {
    controller = new LightController(
      WS_URL,
      'test_client',
      () => {
        expect(controller.getDevices().length).toBe(2);
        done();
      },
      false
    );
  });

  it('should turn on all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.turnOnAllLights((success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should turn off all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.turnOffAllLights((success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should toggle all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.toggleAllLights((success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should set intensity for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.setIntensityForAllLights(100, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should increment intensity for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.incrementIntensityForAllLights(10, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should set CCT for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.setCCTAndIntensityForAllLights(5600, 100, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should increment CCT for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.incrementCCTForAllLights(100, 100, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should set HSI for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.setHSIForAllLights(120, 80, 100, 5600, 0, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should set color for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.setColorForAllLights('red', 100, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });

  it('should set system effect for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await controller.setSystemEffectForAllLights('flash', 100, (success, msg) => {
      expect(success).toBe(true);
      expect(msg).toBe('OK');
    });
  });
});
