import LightController from '../deviceControl/lightControl.js';
import { MockLightServer } from '../test/MockLightServer.js';

const TEST_PORT = 8089;
const WS_URL = `ws://localhost:${TEST_PORT}`;

describe('LightController', () => {
  let server: MockLightServer;
  let controller: LightController | undefined;
  const nodeId = '400J5-F2C008';

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

  it('should fetch protocol versions', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));
    await new Promise<void>((resolve) => {
      controller?.getProtocolVersions((success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toContain(2);
        resolve();
      });
    });
  }, 5000);

  it('should handle scene management', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.saveScene('Midnight', (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).id).toBe('scene-123');
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.recallScene('scene-123', (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });
  }, 5000);

  it('should get intensity and CCT', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await controller.setIntensity(nodeId, 750);
    await new Promise<void>((resolve) => {
      controller?.getIntensity(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(750);
        resolve();
      });
    });

    await controller.setCCT(nodeId, 4500);
    await new Promise<void>((resolve) => {
      controller?.getCCT(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).cct).toBe(4500);
        resolve();
      });
    });
  }, 5000);

  it('should set and get RGB', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setRGB(nodeId, 255, 0, 128, 500, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.getRGB(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).r).toBe(255);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).b).toBe(128);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).intensity).toBe(500);
        resolve();
      });
    });
  }, 5000);

  it('should set and get XY', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setXY(nodeId, 0.3, 0.4, 600, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.getXY(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).x).toBe(0.3);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).y).toBe(0.4);
        resolve();
      });
    });
  }, 5000);

  it('should manage custom effects', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setEffect(nodeId, 'Strobe', { speed: 10 }, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.getEffect(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe('Strobe');
        resolve();
      });
    });
  }, 5000);

  it('should control fan', async () => {
    controller = new LightController(WS_URL, 'test_client', undefined, false);
    await new Promise((res) => setTimeout(res, 200));

    await new Promise<void>((resolve) => {
      controller?.setFanMode(nodeId, 1, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.getFanMode(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(1);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.setFanSpeed(nodeId, 2200, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller?.getFanSpeed(nodeId, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(2200);
        resolve();
      });
    });
  }, 5000);

  describe('Advanced Effect & Preset Control', () => {
    it('should control effect speed and intensity', async () => {
      controller = new LightController(WS_URL, 'test_client', undefined, false);
      await new Promise((res) => setTimeout(res, 200));
      await new Promise<void>((resolve) => {
        controller?.setEffectSpeed(nodeId, 50, (success) => {
          expect(success).toBe(true);
          resolve();
        });
      });

      await new Promise<void>((resolve) => {
        controller?.setEffectIntensity(nodeId, 800, (success) => {
          expect(success).toBe(true);
          resolve();
        });
      });
    });

    it('should set preset', async () => {
      controller = new LightController(WS_URL, 'test_client', undefined, false);
      await new Promise((res) => setTimeout(res, 200));
      await new Promise<void>((resolve) => {
        controller?.setPreset(nodeId, 'preset-456', (success, _msg, data) => {
          expect(success).toBe(true);
          // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
          expect((data as any).id).toBe('preset-456');
          resolve();
        });
      });
    });
  });

  describe('Quickshot Control', () => {
    it('should get quickshot list', async () => {
      controller = new LightController(WS_URL, 'test_client', undefined, false);
      await new Promise((res) => setTimeout(res, 200));
      await new Promise<void>((resolve) => {
        controller?.getQuickshotList((success, _msg, data) => {
          expect(success).toBe(true);
          // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
          expect((data as any).data.length).toBeGreaterThan(0);
          resolve();
        });
      });
    });

    it('should set quickshot', async () => {
      controller = new LightController(WS_URL, 'test_client', undefined, false);
      await new Promise((res) => setTimeout(res, 200));
      await new Promise<void>((resolve) => {
        controller?.setQuickshot('qs-123', (success, _msg, data) => {
          expect(success).toBe(true);
          expect(data).toBe('qs-123');
          resolve();
        });
      });
    });
  });

  describe('Group Management', () => {
    it('should manage groups', async () => {
      controller = new LightController(WS_URL, 'test_client', undefined, false);
      await new Promise((res) => setTimeout(res, 200));
      let createdGroupId = '';

      // Create group
      await new Promise<void>((resolve) => {
        controller?.createGroup('All Room', (success, _msg, data) => {
          expect(success).toBe(true);
          // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
          createdGroupId = (data as any).id;
          resolve();
        });
      });

      // Add to group
      await new Promise<void>((resolve) => {
        controller?.addToGroup(createdGroupId, nodeId, (success) => {
          expect(success).toBe(true);
          resolve();
        });
      });

      // Get group list
      await new Promise<void>((resolve) => {
        controller?.getGroupList((success) => {
          expect(success).toBe(true);
          resolve();
        });
      });

      // Remove from group
      await new Promise<void>((resolve) => {
        controller?.removeFromGroup(createdGroupId, nodeId, (success) => {
          expect(success).toBe(true);
          resolve();
        });
      });

      // Delete group
      await new Promise<void>((resolve) => {
        controller?.deleteGroup(createdGroupId, (success) => {
          expect(success).toBe(true);
          resolve();
        });
      });
    });
  });
});
