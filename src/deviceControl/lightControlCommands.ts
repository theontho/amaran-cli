import { DEVICE_DEFAULTS } from './constants.js';
import type { CommandArgs, CommandCallback, CommandType, Device } from './types.js';

export abstract class LightControllerCommands {
  protected abstract sendCommand(
    nodeId: string | undefined,
    type: CommandType,
    args?: CommandArgs,
    callback?: CommandCallback
  ): void;
  protected abstract getLightControlDevices(): Device[];
  protected abstract isLightNodeId(nodeId: string): boolean;
  protected abstract sleep(ms: number): Promise<void>;
  protected abstract log(...args: unknown[]): void;

  private async applyToAllLights(
    commandFn: (nodeId: string, callback?: CommandCallback) => void,
    commandName: string,
    getDisplayArgs?: (device: Device) => string
  ): Promise<void> {
    try {
      const devices = this.getLightControlDevices();
      if (devices.length === 0) {
        this.log('No devices found');
        return;
      }

      const lightDevices = devices.filter((device) =>
        typeof device.node_id === 'string' ? this.isLightNodeId(device.node_id) : false
      );

      if (lightDevices.length === 0) {
        this.log('No light devices found');
        return;
      }

      this.log(`${commandName} for ${lightDevices.length} light(s)`);

      const waitTimeMs = DEVICE_DEFAULTS.commandThrottleDelay;
      for (let i = 0; i < lightDevices.length; i++) {
        const device = lightDevices[i];
        const displayName = device.device_name || device.name || device.node_id || 'Unknown';
        const displayArgs = getDisplayArgs ? getDisplayArgs(device) : '';

        if (process.env.NODE_ENV !== 'test') {
          console.log(`  ${commandName} ${displayName} (${device.node_id})${displayArgs}`);
        }

        if (device.node_id) {
          commandFn(device.node_id);
        }

        if (i < lightDevices.length - 1) {
          await this.sleep(waitTimeMs);
        }
      }
    } catch (error) {
      console.error('Error in applyToAllLights:', error);
      throw error;
    }
  }

  public async setCCTAndIntensityForAllLights(cct: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setCCT(nodeId, cct, intensity, callback),
      'Setting CCT',
      () => ` to ${cct}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public async turnOnAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOn(nodeId, callback), 'Turning on');
  }

  public async turnOffAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.turnLightOff(nodeId, callback), 'Turning off');
  }

  public async toggleAllLights(callback?: CommandCallback) {
    await this.applyToAllLights((nodeId) => this.toggleLight(nodeId, callback), 'Toggling');
  }

  public async setIntensityForAllLights(intensity: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setIntensity(nodeId, intensity, callback),
      'Setting intensity',
      () => ` to ${intensity / 10}%`
    );
  }

  public async incrementIntensityForAllLights(delta: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementIntensity(nodeId, delta, callback),
      'Incrementing intensity',
      () => ` by ${delta > 0 ? '+' : ''}${delta / 10}%`
    );
  }

  public async incrementCCTForAllLights(delta: number, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.incrementCCT(nodeId, delta, intensity, callback),
      'Incrementing CCT',
      () => ` by ${delta > 0 ? '+' : ''}${delta}K${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public async setHSIForAllLights(
    hue: number,
    sat: number,
    intensity: number,
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ) {
    await this.applyToAllLights(
      (nodeId) => this.setHSI(nodeId, hue, sat, intensity, cct, gm, callback),
      'Setting HSI',
      () => ` to H:${hue} S:${sat} I:${intensity / 10}%`
    );
  }

  public async setColorForAllLights(color: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setColor(nodeId, color, intensity, callback),
      'Setting color',
      () => ` to ${color}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public async setSystemEffectForAllLights(effectType: string, intensity?: number, callback?: CommandCallback) {
    await this.applyToAllLights(
      (nodeId) => this.setSystemEffect(nodeId, effectType, intensity, callback),
      'Setting effect',
      () => ` to ${effectType}${intensity !== undefined ? ` at ${intensity / 10}%` : ''}`
    );
  }

  public getFixtureList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_fixture_list', {}, callback);
  }

  public getDeviceList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_device_list', {}, callback);
  }

  public getSceneList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_scene_list', {}, callback);
  }

  public saveScene(name: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'save_scene', { name }, callback);
  }

  public deleteScene(sceneId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'delete_scene', { id: sceneId }, callback);
  }

  public recallScene(sceneId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'recall_scene', { id: sceneId }, callback);
  }

  public updateScene(sceneId: string, name?: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'update_scene', { id: sceneId, name }, callback);
  }

  public getPresetList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_preset_list', {}, callback);
  }

  public recallPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'recall_preset', { id: presetId }, callback);
  }

  public setPreset(nodeId: string, presetId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_preset', { preset_id: presetId }, callback);
  }

  public getSystemEffectList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_system_effect_list', {}, callback);
  }

  public getQuickshotList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_quickshot_list', {}, callback);
  }

  public setQuickshot(quickshotId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'set_quickshot', { quickshot_id: quickshotId }, callback);
  }

  public getGroupList(callback?: CommandCallback) {
    this.sendCommand(undefined, 'get_group_list', {}, callback);
  }

  public createGroup(name: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'create_group', { name }, callback);
  }

  public deleteGroup(groupId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'delete_group', { id: groupId }, callback);
  }

  public addToGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'add_to_group', { group_id: groupId, node_id: nodeId }, callback);
  }

  public removeFromGroup(groupId: string, nodeId: string, callback?: CommandCallback) {
    this.sendCommand(undefined, 'remove_from_group', { group_id: groupId, node_id: nodeId }, callback);
  }

  public getNodeConfig(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_node_config', {}, callback);
  }

  public turnLightOn(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: false }, callback);
  }

  public turnLightOff(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_sleep', { sleep: true }, callback);
  }

  public getLightSleepStatus(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_sleep', {}, callback);
  }

  public toggleLight(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'toggle_sleep', undefined, callback);
  }

  public getIntensity(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_intensity', {}, callback);
  }

  public setIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_intensity', { intensity }, callback);
  }

  public incrementIntensity(nodeId: string, delta: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'increase_intensity', { delta }, callback);
  }

  public getCCT(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_cct', {}, callback);
  }

  public setCCT(nodeId: string, cct: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { cct };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_cct', args, callback);
  }

  public incrementCCT(nodeId: string, delta: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { delta };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'increase_cct', args, callback);
  }

  public getHSI(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_hsi', {}, callback);
  }

  public setHSI(
    nodeId: string,
    hue: number,
    sat: number,
    intensity: number,
    cct?: number,
    gm?: number,
    callback?: CommandCallback
  ) {
    const args: CommandArgs = { hue, sat, intensity };
    if (cct !== undefined) {
      args.cct = cct;
    }
    if (gm !== undefined) {
      args.gm = gm;
    }
    this.sendCommand(nodeId, 'set_hsi', args, callback);
  }

  public getRGB(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_rgb', {}, callback);
  }

  public setRGB(nodeId: string, r: number, g: number, b: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { r, g, b };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_rgb', args, callback);
  }

  public getXY(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_xy', {}, callback);
  }

  public setXY(nodeId: string, x: number, y: number, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { x, y };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_xy', args, callback);
  }

  public setColor(nodeId: string, color: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { color };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_color', args, callback);
  }

  public getSystemEffect(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_system_effect', {}, callback);
  }

  public setSystemEffect(nodeId: string, effectType: string, intensity?: number, callback?: CommandCallback) {
    const args: CommandArgs = { effect_type: effectType };
    if (intensity !== undefined) {
      args.intensity = intensity;
    }
    this.sendCommand(nodeId, 'set_system_effect', args, callback);
  }

  public getEffect(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_effect', {}, callback);
  }

  public setEffect(nodeId: string, effectName: string, args?: CommandArgs, callback?: CommandCallback) {
    const combinedArgs: CommandArgs = { name: effectName, ...args };
    this.sendCommand(nodeId, 'set_effect', combinedArgs, callback);
  }

  public getFanMode(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_fan_mode', {}, callback);
  }

  public setFanMode(nodeId: string, mode: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_fan_mode', { mode }, callback);
  }

  public getFanSpeed(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_fan_speed', {}, callback);
  }

  public setFanSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_fan_speed', { speed }, callback);
  }

  public setEffectSpeed(nodeId: string, speed: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_effect_speed', { speed }, callback);
  }

  public setEffectIntensity(nodeId: string, intensity: number, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'set_effect_intensity', { intensity }, callback);
  }

  public getDeviceInfo(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'get_device_info', {}, callback);
  }

  public updateFirmware(nodeId: string, callback?: CommandCallback) {
    this.sendCommand(nodeId, 'update_firmware', {}, callback);
  }
}
