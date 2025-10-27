import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const execAsync = promisify(exec);

export interface DiscoveryResult {
  url: string; // e.g., ws://127.0.0.1:60124
  port: number;
  process: string; // matched process name (e.g., amaran)
}

// Parse lsof output lines for ports bound by processes starting with "amaran"
export function parseAmaranPorts(
  lsofOutput: string
): Array<{ port: number; process: string; iface: '127.0.0.1' | '::1' }> {
  const results: Array<{ port: number; process: string; iface: '127.0.0.1' | '::1' }> = [];
  const lines = lsofOutput.split(/\r?\n/);
  for (const line of lines) {
    // Trim and quickly filter
    const trimmed = line.trim();
    if (!trimmed) continue;
    // lsof table rows typically start with COMMAND name in column 1
    // We only care about processes that start with "amaran" (case-insensitive)
    const startsWithAmaran = /^amaran/i.test(trimmed);
    if (!startsWithAmaran) continue;

    // Look for localhost binds and capture port
    // Examples (macOS):
    // amaran   1234 mac  10u  IPv4 ... TCP 127.0.0.1:60124 (LISTEN)
    // amaran   1234 mac  11u  IPv6 ... TCP [::1]:60124 (LISTEN)
    // amaran   1234 mac  12u  IPv4 ... TCP 127.0.0.1:60124->127.0.0.1:65000 (ESTABLISHED)

    let match: RegExpMatchArray | null = null;
    let iface: '127.0.0.1' | '::1' | null = null;

    match = trimmed.match(/127\.0\.0\.1:(\d+)/);
    if (match) {
      iface = '127.0.0.1';
    } else {
      match = trimmed.match(/\[::1\]:(\d+)/);
      if (match) {
        iface = '::1';
      }
    }
    if (!match || !iface) continue;

    const port = parseInt(match[1], 10);
    if (!Number.isFinite(port)) continue;

    // Prefer LISTEN sockets, but also record ESTABLISHED as fallback
    const isListen = /\(LISTEN\)/.test(trimmed);
    // Ensure uniqueness (port, iface)
    if (!results.some((r) => r.port === port && r.iface === iface)) {
      results.push({ port, process: trimmed.split(/\s+/)[0], iface });
    }

    // If it's a LISTEN entry, push it to the front to prioritize
    if (isListen) {
      const idx = results.findIndex((r) => r.port === port && r.iface === iface);
      if (idx > 0) {
        const [item] = results.splice(idx, 1);
        results.unshift(item);
      }
    }
  }
  return results;
}

async function probeWebSocket(url: string, timeoutMs = 1200): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.terminate();
        } catch {}
        resolve(false);
      }
    }, timeoutMs);

    ws.on('open', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
        resolve(true);
      }
    });
    ws.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
}

export async function discoverLocalWebSocket(
  preferredHost: '127.0.0.1' | 'localhost' = '127.0.0.1',
  debug = false
): Promise<DiscoveryResult | null> {
  try {
    const { stdout } = await execAsync('lsof -i -P -n');
    const candidates = parseAmaranPorts(stdout);
    if (debug) {
      // eslint-disable-next-line no-console
      console.log('[discovery] lsof candidates:', candidates);
    }
    // Try LISTEN candidates first (we unshifted those), then others
    for (const c of candidates) {
      const host =
        preferredHost === 'localhost' ? 'localhost' : c.iface === '::1' ? '127.0.0.1' : '127.0.0.1';
      const url = `ws://${host}:${c.port}`;
      const ok = await probeWebSocket(url, 1200);
      if (ok) {
        return { url, port: c.port, process: c.process };
      }
    }
  } catch (err) {
    if (debug) {
      // eslint-disable-next-line no-console
      console.log('[discovery] lsof failed:', err);
    }
  }
  return null;
}

export default discoverLocalWebSocket;
