import { WebSocketServer } from 'ws';
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
        const response: {
          code: number;
          message: string;
          request: { type: string };
          data?: unknown;
        } = {
          code: 0,
          message: 'OK',
          request: { type: cmd.type },
        };
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
  close(callback?: () => void) {
    this.wss.clients.forEach((client) => {
      client.terminate();
    });
    this.wss.close(callback);
  }
}

describe('LightController', () => {
  let server: MockLightServer;
  let controller: LightController | undefined;

  beforeAll(async () => {
    server = new MockLightServer(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 200)); // Give server time to start
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        setTimeout(resolve, 100); // Give server time to fully close
      });
    });
  });

  afterEach(async () => {
    if (controller) {
      await controller.disconnect();
      controller = undefined; // Clear reference
    }
  });

  it('should initialize and fetch devices', async () => {
    controller = new LightController(
      WS_URL,
      'test_client',
      () => {
        expect(controller?.getDevices().length).toBe(2);
      },
      false
    );
    // Wait for connection/init
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(controller?.getDevices().length).toBe(2);
  }, 5000);

  it('should turn on all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.turnOnAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should turn off all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.turnOffAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should toggle all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.toggleAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set intensity for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setIntensityForAllLights(100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should increment intensity for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.incrementIntensityForAllLights(10, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set CCT for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setCCTAndIntensityForAllLights(5600, 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should increment CCT for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.incrementCCTForAllLights(100, 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set HSI for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setHSIForAllLights(120, 80, 100, 5600, 0, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set color for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setColorForAllLights('red', 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set system effect for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setSystemEffectForAllLights('flash', 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);
});
