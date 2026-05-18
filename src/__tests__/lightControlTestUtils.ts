import LightController from '../deviceControl/lightControl.js';
import { MockLightServer } from '../test/MockLightServer.js';

export const TEST_NODE_ID = '400J5-F2C008';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setupLightControllerSuite(testPort: number) {
  const wsUrl = `ws://localhost:${testPort}`;
  let server: MockLightServer;
  let controller: LightController | undefined;

  beforeAll(async () => {
    server = new MockLightServer(testPort);
    await wait(500);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) console.error('Error closing server:', err);
        resolve();
      });
    });
    await wait(100);
  });

  afterEach(async () => {
    if (controller) {
      await controller.disconnect();
      controller = undefined;
    }
    server.resetState();
  });

  const createController = (onInitialized?: () => void) => {
    controller = new LightController(wsUrl, 'test_client', onInitialized, false);
    return controller;
  };

  const createReadyController = async (onInitialized?: () => void) => {
    const readyController = createController(onInitialized);
    await wait(200);
    return readyController;
  };

  return {
    createController,
    createReadyController,
    get controller() {
      return controller;
    },
    get server() {
      return server;
    },
  };
}
