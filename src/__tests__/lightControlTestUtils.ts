import LightController from '../deviceControl/lightControl.js';
import { MockLightServer } from '../test/MockLightServer.js';

export const TEST_NODE_ID = '400J5-F2C008';

export function setupLightControllerSuite(testPort: number) {
  const wsUrl = `ws://localhost:${testPort}`;
  let server: MockLightServer;
  let controller: LightController | undefined;

  beforeAll(async () => {
    server = new MockLightServer(testPort);
    await server.ready;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
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
    const readyController = await new Promise<LightController>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Controller initialization timeout')), 2000);
      const nextController = new LightController(
        wsUrl,
        'test_client',
        () => {
          clearTimeout(timeout);
          onInitialized?.();
          resolve(nextController);
        },
        false
      );
      controller = nextController;
    });
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
