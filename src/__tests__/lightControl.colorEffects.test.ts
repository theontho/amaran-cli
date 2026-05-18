import { setupLightControllerSuite, TEST_NODE_ID } from './lightControlTestUtils.js';

describe('LightController color, effects, and hardware commands', () => {
  const fixture = setupLightControllerSuite(18090);

  it('should set HSI for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setHSIForAllLights(120, 80, 100, 5600, 0, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.hue).toBe(120);
    expect(state?.sat).toBe(80);
    expect(state?.intensity).toBe(100);
    expect(state?.work_mode).toBe('HSI');
  }, 5000);

  it('should set color for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setColorForAllLights('red', 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should set system effect for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setSystemEffectForAllLights('flash', 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });
  }, 5000);

  it('should get intensity and CCT', async () => {
    const controller = await fixture.createReadyController();

    controller.setIntensity(TEST_NODE_ID, 750);
    await new Promise<void>((resolve) => {
      controller.getIntensity(TEST_NODE_ID, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(750);
        resolve();
      });
    });

    controller.setCCT(TEST_NODE_ID, 4500);
    await new Promise<void>((resolve) => {
      controller.getCCT(TEST_NODE_ID, (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).cct).toBe(4500);
        resolve();
      });
    });
  }, 5000);

  it('should set and get RGB', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setRGB(TEST_NODE_ID, 255, 0, 128, 500, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getRGB(TEST_NODE_ID, (success, _msg, data) => {
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
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setXY(TEST_NODE_ID, 0.3, 0.4, 600, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getXY(TEST_NODE_ID, (success, _msg, data) => {
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
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setEffect(TEST_NODE_ID, 'Strobe', { speed: 10 }, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getEffect(TEST_NODE_ID, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe('Strobe');
        resolve();
      });
    });
  }, 5000);

  it('should control fan', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setFanMode(TEST_NODE_ID, 1, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getFanMode(TEST_NODE_ID, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(1);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.setFanSpeed(TEST_NODE_ID, 2200, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getFanSpeed(TEST_NODE_ID, (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe(2200);
        resolve();
      });
    });
  }, 5000);

  it('should control effect speed and intensity', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setEffectSpeed(TEST_NODE_ID, 50, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.setEffectIntensity(TEST_NODE_ID, 800, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });
  });
});
