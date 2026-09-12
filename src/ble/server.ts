import { createServer, type IncomingMessage } from 'node:http';
import { z } from 'zod';
import { capabilities, type VerifiedController, validateAction } from './controller.js';
import { planDesktopImport } from './desktopLibrary.js';
import { type LibraryCollection, LocalLibrary } from './library.js';
import { Programs } from './programs.js';
import type { MeshConfig } from './storage.js';
import { parseFanMode, validateFanRpm } from './telink.js';

async function bodyOf(request: IncomingMessage, maximum = 4096): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new Error(`Request body exceeds ${maximum} bytes`);
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const value: unknown = raw ? JSON.parse(raw) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

export function createBleServer(
  controller: VerifiedController,
  library = new LocalLibrary(),
  options: { persistMesh?: (config: MeshConfig) => void } = {}
) {
  const fanTargets = (targets: 'all' | string[]): string[] => {
    if (targets === 'all') return controller.config.lights.map((light) => light.key);
    return [...new Set(targets.flatMap((key) => (key.startsWith('group:') ? library.group(key).members : [key])))];
  };
  const programs = new Programs(controller, fanTargets);
  const manual = async (keys: string[], action: string, args: Record<string, unknown>) => {
    if (!keys.length || new Set(keys).size !== keys.length)
      throw new Error('Manual control requires unique, nonempty targets');
    for (const key of keys) {
      const light = controller.config.lights.find((item) => item.key === key);
      if (!light) throw new Error(`Unknown fixture ${key}`);
      validateAction(light, action, args);
    }
    await programs.cancelTargets(keys);
  };
  const stopForFan = async (keys: string[], mode: unknown, rpm: unknown) => {
    if (mode === undefined) return;
    const selected = parseFanMode(mode);
    validateFanRpm(selected, rpm);
    if (selected !== 'off' && !(selected === 'manual' && rpm === 0)) return;
    const states = await controller.fans(keys);
    for (const [key, state] of Object.entries(states)) {
      if (!state.supported[selected]) throw new Error(`${key} does not advertise ${selected} fan mode`);
      if (state.highTemperature) throw new Error(`${key}: Thermal protection is active`);
    }
    await programs.cancelTargets(keys);
  };
  const server = createServer(async (request, response) => {
    const reply = (status: number, value: unknown) => {
      if (!response.destroyed) {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify(value));
      }
    };
    const cancellation = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) cancellation.abort(new Error('HTTP client disconnected'));
    });
    try {
      if (request.headers.origin) {
        reply(403, { ok: false, error: 'Browser-origin requests are not permitted' });
        return;
      }
      const route = request.url ?? '/';
      if (request.method === 'GET' && (route === '/' || route === '/lights' || route === '/health')) {
        reply(200, {
          ok: true,
          daemon: true,
          protocolVersion: 2,
          connected: controller.link.ready,
          features: {
            state: true,
            verifiedCommands: true,
            toggle: true,
            gm: true,
            fan: true,
            fanTargets: true,
            fanManualRpm: true,
            automaticCct: true,
            productInfo: true,
            transitions: true,
            effectTrigger: true,
            meshConfig: !!controller.link.configuration,
            desktopImport: true,
            programs: true,
            effects: true,
            color: true,
            relative: true,
            batch: true,
            library: true,
            fade: true,
          },
          lights: controller.config.lights.map((light) => ({
            key: light.key,
            name: light.name,
            mac: light.mac,
            address: light.address,
            model: light.model,
            capabilities: capabilities(light),
          })),
          groups: library.groups(),
        });
        return;
      }
      if (route === '/effects' && request.method === 'GET') {
        reply(200, {
          ok: true,
          result: [...new Set(controller.config.lights.flatMap((light) => capabilities(light).effects))],
        });
        return;
      }
      if (route === '/programs') {
        if (request.method === 'GET') {
          reply(200, { ok: true, result: programs.list() });
          return;
        }
        if (request.method === 'POST') {
          reply(202, { ok: true, result: await programs.start(await bodyOf(request, 65536)) });
          return;
        }
      }
      const sample = /^\/programs\/([^/]+)\/sample$/.exec(route);
      if (sample && request.method === 'POST') {
        programs.sample(decodeURIComponent(sample[1]), await bodyOf(request));
        reply(200, { ok: true, result: { accepted: true } });
        return;
      }
      const program = /^\/programs\/([^/]+)$/.exec(route);
      if (program) {
        if (request.method === 'GET') {
          reply(200, { ok: true, result: programs.get(decodeURIComponent(program[1])) });
          return;
        }
        if (request.method === 'DELETE') {
          reply(200, { ok: true, result: await programs.stop(decodeURIComponent(program[1])) });
          return;
        }
      }
      if (route === '/desktop/import' && request.method === 'POST') {
        const body = z
          .object({
            database: z.string(),
            prefix: z.string().optional(),
            apply: z.boolean().default(false),
            replace: z.boolean().default(false),
            allowPartial: z.boolean().default(false),
          })
          .strict()
          .parse(await bodyOf(request));
        const report = planDesktopImport(body.database, controller.config, body.prefix);
        if (body.apply && report.errors.length && !body.allowPartial)
          throw new Error(`Import has unresolved entries: ${report.errors.join('; ')}`);
        let changes: unknown;
        try {
          changes = library.importLibrary(report.plan, body.apply, body.replace);
        } catch (error) {
          if (body.apply) throw error;
          report.errors.push((error as Error).message);
        }
        reply(200, { ok: true, result: { ...report, valid: report.errors.length === 0, changes } });
        return;
      }
      if (route === '/mesh/inspect' && request.method === 'GET') {
        reply(200, { ok: true, verified: true, result: await controller.nativeGroup(library, undefined, 'inspect') });
        return;
      }
      if (route === '/mesh/discover' && request.method === 'GET') {
        reply(200, { ok: true, result: await controller.discoverUnprovisioned() });
        return;
      }
      if (route === '/mesh/keys' && request.method === 'POST') {
        if (!options.persistMesh) throw new Error('Private mesh persistence is unavailable');
        const body = z
          .object({ database: z.string() })
          .strict()
          .parse(await bodyOf(request));
        const imported = await controller.importDeviceKeys(body.database, options.persistMesh);
        reply(200, { ok: true, result: { imported } });
        return;
      }
      if (route === '/overrides' && request.method === 'POST') {
        const body = z
          .object({
            targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
            minutes: z.number().min(0).max(1440).optional(),
          })
          .strict()
          .parse(await bodyOf(request));
        const keys = fanTargets(body.targets);
        if (body.minutes !== undefined) await programs.cancelTargets(keys);
        const result =
          body.minutes === undefined
            ? controller.overrideStatus(keys)
            : await controller.override(keys, body.minutes, cancellation.signal);
        reply(200, { ok: true, result });
        return;
      }
      if (route === '/transition' && request.method === 'POST') {
        const body = z
          .object({
            targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
            action: z.enum(['cct', 'hsi', 'brightness']),
            args: z.record(z.unknown()),
            seconds: z.number().min(0.5).max(20),
          })
          .strict()
          .parse(await bodyOf(request));
        await manual(fanTargets(body.targets), body.action, body.args);
        reply(200, {
          ok: true,
          verified: true,
          result: await controller.transition(
            fanTargets(body.targets),
            body.action,
            body.args,
            body.seconds,
            cancellation.signal
          ),
        });
        return;
      }
      const automatic = /^\/lights\/([^/]+)\/auto-cct$/.exec(route);
      if (automatic && request.method === 'POST') {
        const result = await controller.automaticCct(
          decodeURIComponent(automatic[1]),
          await bodyOf(request),
          cancellation.signal
        );
        reply(200, { ok: true, verified: !result.skipped, result });
        return;
      }
      const information = /^\/lights\/([^/]+)\/info$/.exec(route);
      if (information && request.method === 'GET') {
        const key = decodeURIComponent(information[1]);
        if (key.startsWith('group:')) {
          const keys = fanTargets([key]);
          if (!keys.length) throw new Error('Group has no fixtures');
          const result: Record<string, unknown> = {};
          for (const member of keys) result[member] = await controller.productInfo(member);
          reply(200, { ok: true, verified: true, result });
          return;
        }
        reply(200, {
          ok: true,
          verified: true,
          result: await controller.productInfo(decodeURIComponent(information[1])),
        });
        return;
      }
      if (route === '/fans' && (request.method === 'GET' || request.method === 'POST')) {
        const body =
          request.method === 'GET'
            ? { targets: 'all' as const }
            : z
                .object({
                  targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
                  mode: z.union([z.string(), z.number()]).optional(),
                  rpm: z.number().int().min(0).max(65535).optional(),
                })
                .strict()
                .parse(await bodyOf(request));
        await stopForFan(
          fanTargets(body.targets),
          'mode' in body ? body.mode : undefined,
          'rpm' in body ? body.rpm : undefined
        );
        const states = await controller.fans(
          fanTargets(body.targets),
          'mode' in body ? body.mode : undefined,
          cancellation.signal,
          'rpm' in body ? body.rpm : undefined
        );
        reply(200, { ok: true, verified: true, result: { states } });
        return;
      }
      if (route === '/batch' && request.method === 'POST') {
        const body = z
          .object({
            targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
            action: z.string(),
            args: z.record(z.unknown()),
            broadcast: z.boolean().optional(),
          })
          .strict()
          .parse(await bodyOf(request));
        const keys = body.targets === 'all' ? controller.config.lights.map((light) => light.key) : body.targets;
        await manual(keys, body.action, body.args);
        const result = await controller.batch(keys, body.action, body.args, body.broadcast, cancellation.signal);
        reply(200, { ok: true, verified: true, result });
        return;
      }
      if (route === '/fade' && request.method === 'POST') {
        const body = z
          .object({
            targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
            brightness: z.number().min(0).max(100),
            seconds: z.number().min(0.5).max(20),
          })
          .strict()
          .parse(await bodyOf(request));
        const keys = body.targets === 'all' ? controller.config.lights.map((light) => light.key) : body.targets;
        await manual(keys, 'brightness', { value: body.brightness });
        reply(200, {
          ok: true,
          verified: true,
          result: await controller.fade(keys, body.brightness, body.seconds, cancellation.signal),
        });
        return;
      }
      const libraryRoute = /^\/library\/(scenes|presets|quickshots)(?:\/([^/]+)(?:\/(recall))?)?$/.exec(route);
      if (libraryRoute) {
        const collection = libraryRoute[1] as LibraryCollection;
        const key = libraryRoute[2] ? decodeURIComponent(libraryRoute[2]) : undefined;
        if (request.method === 'GET') {
          reply(200, { ok: true, result: key ? library.find(collection, key) : library.list(collection) });
          return;
        }
        if (key && request.method === 'DELETE') {
          library.delete(collection, key);
          reply(200, { ok: true, result: { deleted: key } });
          return;
        }
        if (request.method === 'POST') {
          if (key && libraryRoute[3] === 'recall') {
            const body = z
              .object({ target: z.string().optional(), seconds: z.number().optional() })
              .strict()
              .parse(await bodyOf(request));
            const saved = library.find(collection, key);
            if (body.target && (collection !== 'presets' || Object.keys(saved.states).length !== 1))
              throw new Error('Only a single-fixture preset can be retargeted');
            const states = body.target ? { [body.target]: Object.values(saved.states)[0] } : saved.states;
            await programs.cancelTargets(Object.keys(states));
            const result =
              body.seconds === undefined
                ? await controller.restore(states, cancellation.signal)
                : await controller.transitionScene(states, body.seconds, cancellation.signal);
            reply(200, { ok: true, verified: true, result });
            return;
          }
          const body = z
            .object({ name: z.string().optional(), keys: z.array(z.string()).min(1).optional() })
            .strict()
            .parse(await bodyOf(request));
          const existing = key ? library.find(collection, key) : undefined;
          const states = await controller.snapshot(body.keys ?? (existing ? Object.keys(existing.states) : undefined));
          cancellation.signal.throwIfAborted();
          const result = library.save(collection, body.name ?? existing?.name, states, key);
          reply(200, { ok: true, result });
          return;
        }
      }
      const groupRoute = /^\/groups(?:\/([^/]+)(?:\/(members|rename|native))?)?$/.exec(route);
      if (groupRoute) {
        const key = groupRoute[1] ? decodeURIComponent(groupRoute[1]) : undefined;
        if (request.method === 'GET') {
          reply(200, { ok: true, result: key ? library.group(key) : library.groups() });
          return;
        }
        if (key && request.method === 'DELETE') {
          if (library.group(key).native) await controller.nativeGroup(library, key, 'disable');
          library.deleteGroup(key);
          reply(200, { ok: true, result: { deleted: key } });
          return;
        }
        if (request.method === 'POST') {
          if (key && groupRoute[2] === 'native') {
            const body = z
              .object({
                action: z.enum(['enable', 'sync', 'disable']),
                address: z.number().int().min(0xc000).max(0xfeff).optional(),
              })
              .strict()
              .parse(await bodyOf(request));
            reply(200, {
              ok: true,
              verified: true,
              result: await controller.nativeGroup(library, key, body.action, body.address),
            });
            return;
          }
          if (key && groupRoute[2] === 'members') {
            const body = z
              .object({ member: z.string(), remove: z.boolean().optional() })
              .strict()
              .parse(await bodyOf(request));
            if (!controller.config.lights.some((light) => light.key === body.member))
              throw new Error(`Unknown fixture: ${body.member}`);
            if (library.group(key).native)
              await controller.nativeGroup(library, key, body.remove ? 'remove' : 'add', body.member);
            else library.updateGroup(key, body.member, body.remove ?? false);
            reply(200, { ok: true, result: library.group(key) });
          } else {
            const body = z
              .object({ name: z.string() })
              .strict()
              .parse(await bodyOf(request));
            if (
              body.name.trim().toLowerCase() === 'all' ||
              controller.config.lights.some((light) =>
                [light.key, light.name].some((value) => value.toLowerCase() === body.name.trim().toLowerCase())
              )
            ) {
              throw new Error('Group names must be distinct from all and physical fixture names/keys');
            }
            reply(200, {
              ok: true,
              result:
                key && groupRoute[2] === 'rename'
                  ? library.renameGroup(key, body.name)
                  : library.createGroup(body.name),
            });
          }
          return;
        }
      }
      const match = /^\/lights\/([^/]+)\/([a-z-]+)$/.exec(route);
      if (!match || (request.method !== 'POST' && !(request.method === 'GET' && ['state', 'fan'].includes(match[2])))) {
        reply(404, { ok: false, error: 'Unknown BLE API route' });
        return;
      }
      const body = request.method === 'GET' ? {} : await bodyOf(request);
      const key = decodeURIComponent(match[1]);
      if (!['state', 'fan'].includes(match[2])) await manual(fanTargets([key]), match[2], body);
      let result: unknown;
      if (match[2] === 'fan') {
        const args = z
          .object({
            mode: z.union([z.string(), z.number()]).optional(),
            rpm: z.number().int().min(0).max(65535).optional(),
          })
          .strict()
          .parse(body);
        await stopForFan(fanTargets([key]), args.mode, args.rpm);
        result = key.startsWith('group:')
          ? { states: await controller.fans(fanTargets([key]), args.mode, cancellation.signal, args.rpm) }
          : await controller.fan(key, args.mode, cancellation.signal, args.rpm);
      } else if (key.startsWith('group:')) {
        const group = library.group(key);
        if (match[2] === 'state') result = await controller.snapshot(group.members, false);
        else
          result = await controller.batch(
            group.members,
            match[2],
            body,
            false,
            cancellation.signal,
            group.native?.status === 'ready' ? group.native.address : undefined
          );
      } else result = await controller.execute(key, match[2], body, cancellation.signal);
      reply(200, { ok: true, verified: true, result });
    } catch (error) {
      console.error(`BLE API request failed: ${(error as Error).message}`);
      reply(400, { ok: false, error: (error as Error).message });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 65_000;
  server.on('close', () => {
    void programs.close().catch((error) => console.error(`Program shutdown failed: ${(error as Error).message}`));
  });
  return Object.assign(server, { stopPrograms: () => programs.close() });
}
