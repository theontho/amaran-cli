import LightController from '../deviceControl/lightControl.js';
import { MockLightServer } from '../test/MockLightServer.js';

const TEST_PORT = 8089;
const WS_URL = `ws://localhost:${TEST_PORT}`;

describe('LightController', () => {
  let server: MockLightServer;
  let controller: LightController | undefined;

  beforeAll(async () => {
    server = new MockLightServer(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 500)); // Give server time to start
  });

  afterAll(async () => {
    // We need to ensure the server is closed properly
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) console.error('Error closing server:', err);
        resolve();
      });
    });
    // Add a small buffer to ensure the port is released
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    if (controller) {
      await controller.disconnect();
      controller = undefined; // Clear reference
    }
    server.resetState();
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

    // Check state on server
    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.sleep).toBe(false);
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

    // Check state on server
    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.sleep).toBe(true);
  }, 5000);

  it('should toggle all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    // First ensure it's in a known state (e.g. sleep=false)
    // Direct manipulation of server state would be better, but for now we rely on default being false

    await new Promise<void>((resolve) => {
      controller?.toggleAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    // Default was false, toggle should make it true
    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.sleep).toBe(true);

    // Toggle again
    await new Promise<void>((resolve) => {
      controller?.toggleAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state2 = server.getDeviceState('400J5-F2C008');
    expect(state2?.sleep).toBe(false);
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

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.intensity).toBe(100);
  }, 5000);

  it('should increment intensity for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    // Initial set
    await controller.setIntensityForAllLights(500);
    await new Promise((res) => setTimeout(res, 100));

    await new Promise<void>((resolve) => {
      controller?.incrementIntensityForAllLights(100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = server.getDeviceState('400J5-F2C008');
    // 500 + 100 = 600
    expect(state?.intensity).toBe(600);
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

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.cct).toBe(5600);
    expect(state?.intensity).toBe(100);
    expect(state?.work_mode).toBe('CCT');
  }, 5000);

  it('should increment CCT for all lights', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    // Initial set
    await controller.setCCTAndIntensityForAllLights(3200, 100);
    await new Promise((res) => setTimeout(res, 100));

    await new Promise<void>((resolve) => {
      controller?.incrementCCTForAllLights(100, 200, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = server.getDeviceState('400J5-F2C008');
    // 3200 + 100 = 3300
    expect(state?.cct).toBe(3300);
    expect(state?.intensity).toBe(200);
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

    const state = server.getDeviceState('400J5-F2C008');
    expect(state?.hue).toBe(120);
    expect(state?.sat).toBe(80);
    expect(state?.intensity).toBe(100);
    expect(state?.work_mode).toBe('HSI');
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
    // The mock server doesn't parse 'red' to HSI yet, so we just check OK response
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
