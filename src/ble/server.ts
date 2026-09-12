import { createServer, type IncomingMessage } from 'node:http';
import { z } from 'zod';
import { capabilities, type VerifiedController } from './controller.js';
import { type LibraryCollection, LocalLibrary } from './library.js';

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw new Error('Request body exceeds 4096 bytes');
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const value: unknown = raw ? JSON.parse(raw) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

export function createBleServer(controller: VerifiedController, library = new LocalLibrary()) {
  const fanTargets = (targets: 'all' | string[]): string[] => {
    if (targets === 'all') return controller.config.lights.map((light) => light.key);
    return [...new Set(targets.flatMap((key) => (key.startsWith('group:') ? library.group(key).members : [key])))];
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
            effects: true,
            color: true,
            relative: true,
            batch: true,
            library: true,
            fade: true,
          },
          lights: controller.config.lights.map((light) => ({ ...light, capabilities: capabilities(light) })),
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
        const result = await controller.batch(keys, body.action, body.args, body.broadcast, cancellation.signal);
        reply(200, { ok: true, verified: true, result });
        return;
      }
      if (route === '/fade' && request.method === 'POST') {
        const body = z
          .object({
            targets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
            brightness: z.number(),
            seconds: z.number(),
          })
          .strict()
          .parse(await bodyOf(request));
        const keys = body.targets === 'all' ? controller.config.lights.map((light) => light.key) : body.targets;
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
              .object({ target: z.string().optional() })
              .strict()
              .parse(await bodyOf(request));
            const saved = library.find(collection, key);
            if (body.target && (collection !== 'presets' || Object.keys(saved.states).length !== 1))
              throw new Error('Only a single-fixture preset can be retargeted');
            const states = body.target ? { [body.target]: Object.values(saved.states)[0] } : saved.states;
            const result = await controller.restore(states, cancellation.signal);
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
      const groupRoute = /^\/groups(?:\/([^/]+)(?:\/(members))?)?$/.exec(route);
      if (groupRoute) {
        const key = groupRoute[1] ? decodeURIComponent(groupRoute[1]) : undefined;
        if (request.method === 'GET') {
          reply(200, { ok: true, result: key ? library.group(key) : library.groups() });
          return;
        }
        if (key && request.method === 'DELETE') {
          library.deleteGroup(key);
          reply(200, { ok: true, result: { deleted: key } });
          return;
        }
        if (request.method === 'POST') {
          if (key && groupRoute[2] === 'members') {
            const body = z
              .object({ member: z.string(), remove: z.boolean().optional() })
              .strict()
              .parse(await bodyOf(request));
            if (!controller.config.lights.some((light) => light.key === body.member))
              throw new Error(`Unknown fixture: ${body.member}`);
            library.updateGroup(key, body.member, body.remove ?? false);
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
            reply(200, { ok: true, result: library.createGroup(body.name) });
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
      let result: unknown;
      if (match[2] === 'fan') {
        const args = z
          .object({
            mode: z.union([z.string(), z.number()]).optional(),
            rpm: z.number().int().min(0).max(65535).optional(),
          })
          .strict()
          .parse(body);
        result = key.startsWith('group:')
          ? { states: await controller.fans(fanTargets([key]), args.mode, cancellation.signal, args.rpm) }
          : await controller.fan(key, args.mode, cancellation.signal, args.rpm);
      } else if (key.startsWith('group:')) {
        const group = library.group(key);
        if (match[2] === 'state') result = await controller.snapshot(group.members);
        else result = await controller.batch(group.members, match[2], body, false, cancellation.signal);
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
  return server;
}
