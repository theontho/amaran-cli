import { setupLightControllerSuite, TEST_NODE_ID } from './lightControlTestUtils.js';

describe('LightController basic light commands', () => {
  const fixture = setupLightControllerSuite(18089);

  it('should initialize and fetch devices', async () => {
    const controller = await fixture.createReadyController(() => {
      expect(fixture.controller?.getDevices().length).toBe(2);
    });

    expect(controller.getDevices().length).toBe(2);
  }, 5000);

  it('should turn on all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.turnOnAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.sleep).toBe(false);
  }, 5000);

  it('should turn off all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.turnOffAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.sleep).toBe(true);
  }, 5000);

  it('should toggle all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.toggleAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.sleep).toBe(true);

    await new Promise<void>((resolve) => {
      controller.toggleAllLights((success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state2 = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state2?.sleep).toBe(false);
  }, 5000);

  it('should set intensity for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setIntensityForAllLights(100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.intensity).toBe(100);
  }, 5000);

  it('should increment intensity for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setIntensityForAllLights(500, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.incrementIntensityForAllLights(100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.intensity).toBe(600);
  }, 5000);

  it('should set CCT for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setCCTAndIntensityForAllLights(5600, 100, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.cct).toBe(5600);
    expect(state?.intensity).toBe(100);
    expect(state?.work_mode).toBe('CCT');
  }, 5000);

  it('should increment CCT for all lights', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setCCTAndIntensityForAllLights(3200, 100, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.incrementCCTForAllLights(100, 200, (success, msg) => {
        expect(success).toBe(true);
        expect(msg).toBe('OK');
        resolve();
      });
    });

    const state = fixture.server.getDeviceState(TEST_NODE_ID);
    expect(state?.cct).toBe(3300);
    expect(state?.intensity).toBe(200);
  }, 5000);
});
