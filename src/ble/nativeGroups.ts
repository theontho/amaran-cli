import {
  type ConfigurationLink,
  changeSubscription,
  modelBindings,
  readComposition,
  readConfiguration,
  subscriptions,
} from './configuration.js';
import type { LightingGroup, LocalLibrary } from './library.js';
import type { MeshConfig } from './storage.js';

export class NativeGroups {
  constructor(
    private readonly config: MeshConfig,
    private readonly link: ConfigurationLink,
    private readonly library: LocalLibrary
  ) {}

  async inspect() {
    const result = [];
    for (const light of this.config.lights) {
      const data = await readComposition(this.link, light.address);
      const model = data.models.find(
        (item) => item.element === light.address && item.company === undefined && item.model === 0x1000
      );
      if (!model || !(await modelBindings(this.link, light.address, model)).includes(0))
        throw new Error(`${light.name}: no supported, bound native group model`);
      const groups = await subscriptions(this.link, light.address, model);
      const phase = await readConfiguration(
        this.link,
        light.address,
        Buffer.from([0x80, 0x15, 0, 0]),
        (data) => data.length === 6 && data[0] === 0x80 && data[1] === 0x17 && data.readUInt16LE(3) === 0
      );
      if (phase[2] !== 0) throw new Error(`${light.name}: key-refresh phase query failed (${phase[2]})`);
      result.push({
        key: light.key,
        address: light.address,
        composition: data,
        model,
        groups,
        keyRefreshPhase: phase[5],
      });
    }
    return result;
  }

  async enable(key: string, address?: number): Promise<LightingGroup> {
    let group = this.library.group(key);
    if (!group.members.length) throw new Error('A native group needs fixture members');
    if (group.native) throw new Error('Group already has native configuration; use sync or disable');
    const actual = await this.inspect();
    if (actual.some((item) => item.keyRefreshPhase !== 0))
      throw new Error('Cannot configure groups during mesh key refresh');
    const used = new Set([
      ...actual.flatMap((item) => item.groups),
      ...this.library.groups().flatMap((item) => (item.native ? [item.native.address] : [])),
    ]);
    let selected = address ?? 0xc100;
    if (address === undefined) while (used.has(selected) && selected <= 0xfeff) selected++;
    if (!Number.isInteger(selected) || selected < 0xc000 || selected > 0xfeff || used.has(selected))
      throw new Error('Choose an unused group address in 0xc000-0xfeff');
    for (const member of group.members)
      if (!actual.some((item) => item.key === member)) throw new Error(`Unknown member ${member}`);
    group = this.library.setNativeGroup(group.id, {
      address: selected,
      status: 'pending',
      managed: actual.map((item) => item.key),
    });
    return this.sync(group.id, actual);
  }

  async sync(key: string, actual?: Awaited<ReturnType<NativeGroups['inspect']>>): Promise<LightingGroup> {
    const group = this.library.group(key);
    if (!group.native) throw new Error('Group has no native configuration');
    this.library.setNativeGroup(group.id, { ...group.native, status: 'pending' });
    const observations = actual ?? (await this.inspect());
    if (observations.some((item) => item.keyRefreshPhase !== 0))
      throw new Error('Cannot configure groups during mesh key refresh');
    for (const member of [...group.native.managed, ...group.members])
      if (!observations.some((item) => item.key === member))
        throw new Error(`Native group member ${member} is unavailable`);
    for (const item of observations) {
      if (!group.native.managed.includes(item.key) && item.groups.includes(group.native.address))
        throw new Error(`Unmanaged fixture ${item.key} already uses this group address`);
    }
    const managed = [...new Set([...group.native.managed, ...group.members])];
    this.library.setNativeGroup(group.id, { ...group.native, managed, status: 'pending' });
    for (const item of observations.filter((item) => managed.includes(item.key))) {
      const desired = group.members.includes(item.key);
      if (item.groups.includes(group.native.address) !== desired)
        await changeSubscription(this.link, item.address, item.model, group.native.address, !desired);
    }
    return this.library.setNativeGroup(group.id, { ...group.native, managed, status: 'ready' });
  }

  async member(key: string, member: string, remove: boolean): Promise<LightingGroup> {
    const group = this.library.group(key);
    if (!group.native) throw new Error('Group is not native');
    if (!this.config.lights.some((light) => light.key === member)) throw new Error(`Unknown fixture ${member}`);
    this.library.setNativeGroup(group.id, { ...group.native, status: 'pending' });
    this.library.updateGroup(group.id, member, remove);
    return this.sync(group.id);
  }

  async disable(key: string): Promise<LightingGroup> {
    const group = this.library.group(key);
    if (!group.native) return group;
    this.library.setNativeGroup(group.id, { ...group.native, status: 'pending' });
    const observations = await this.inspect();
    if (observations.some((item) => item.keyRefreshPhase !== 0))
      throw new Error('Cannot configure groups during mesh key refresh');
    for (const member of group.native.managed) {
      const item = observations.find((entry) => entry.key === member);
      if (!item) throw new Error(`Cannot remove subscription from missing fixture ${member}`);
      if (item.groups.includes(group.native.address))
        await changeSubscription(this.link, item.address, item.model, group.native.address, true);
    }
    return this.library.setNativeGroup(group.id, undefined);
  }
}
