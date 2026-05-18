import { setupLightControllerSuite, TEST_NODE_ID } from './lightControlTestUtils.js';

describe('LightController scenes, presets, quickshots, and groups', () => {
  const fixture = setupLightControllerSuite(18091);

  it('should handle scene management', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.saveScene('Midnight', (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).id).toBe('scene-123');
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.recallScene('scene-123', (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });
  }, 5000);

  it('should set preset', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setPreset(TEST_NODE_ID, 'preset-456', (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).id).toBe('preset-456');
        resolve();
      });
    });
  });

  it('should get quickshot list', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.getQuickshotList((success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        expect((data as any).data.length).toBeGreaterThan(0);
        resolve();
      });
    });
  });

  it('should set quickshot', async () => {
    const controller = await fixture.createReadyController();

    await new Promise<void>((resolve) => {
      controller.setQuickshot('qs-123', (success, _msg, data) => {
        expect(success).toBe(true);
        expect(data).toBe('qs-123');
        resolve();
      });
    });
  });

  it('should manage groups', async () => {
    const controller = await fixture.createReadyController();
    let createdGroupId = '';

    await new Promise<void>((resolve) => {
      controller.createGroup('All Room', (success, _msg, data) => {
        expect(success).toBe(true);
        // biome-ignore lint/suspicious/noExplicitAny: Mock data comparison
        createdGroupId = (data as any).id;
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.addToGroup(createdGroupId, TEST_NODE_ID, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.getGroupList((success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.removeFromGroup(createdGroupId, TEST_NODE_ID, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });

    await new Promise<void>((resolve) => {
      controller.deleteGroup(createdGroupId, (success) => {
        expect(success).toBe(true);
        resolve();
      });
    });
  });
});
