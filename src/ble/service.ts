import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { getConfigDir } from '../config.js';

const LABEL = 'com.amaran-cli.ble';
const xml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function manageBleService(action: string): Promise<void> {
  if (process.platform !== 'darwin' || !process.getuid) throw new Error('BLE LaunchAgent management requires macOS');
  if (!['install', 'start', 'stop', 'status'].includes(action))
    throw new Error('Service action must be install, start, stop or status');
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${LABEL}`;
  const filename = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  if (action === 'install') {
    const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
    if (!existsSync(cli)) throw new Error('Build first, then run node dist/cli.js ble service install');
    if (existsSync(filename)) throw new Error(`BLE LaunchAgent already exists: ${filename}. Use ble service start.`);
    const logs = path.join(os.homedir(), 'Library/Logs/amaran-cli');
    mkdirSync(logs, { recursive: true, mode: 0o700 });
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(
      filename,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(cli)}</string><string>ble</string><string>serve</string></array>
<key>EnvironmentVariables</key><dict><key>AMARAN_CLI_CONFIG_DIR</key><string>${xml(getConfigDir())}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'ble.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'ble-error.log'))}</string>
</dict></plist>
`,
      { mode: 0o600, flag: 'wx' }
    );
    execFileSync('launchctl', ['bootstrap', domain, filename], { stdio: 'inherit' });
  } else if (action === 'start') {
    if (!existsSync(filename)) throw new Error('BLE service is not installed');
    const status = spawnSync('launchctl', ['print', target], { encoding: 'utf8' });
    if (status.error) throw status.error;
    execFileSync('launchctl', status.status === 0 ? ['kickstart', target] : ['bootstrap', domain, filename], {
      stdio: 'inherit',
    });
  } else if (action === 'stop') {
    execFileSync('launchctl', ['bootout', target], { stdio: 'inherit' });
    return;
  } else {
    execFileSync('launchctl', ['print', target], { stdio: 'inherit' });
    return;
  }
  let error: unknown;
  for (let attempt = 0; attempt < 75; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:2708/health', { signal: AbortSignal.timeout(1500) });
      const health = await response.json();
      if (!response.ok || !health.connected || !health.features?.verifiedCommands)
        throw new Error('BLE daemon is not ready');
      console.log(`BLE service is running with verified control for ${health.lights.length} fixtures.`);
      return;
    } catch (failure) {
      error = failure;
    }
    await delay(1000);
  }
  throw new Error(
    `BLE service did not become ready: ${(error as Error).message}. Inspect ~/Library/Logs/amaran-cli/ble-error.log`
  );
}
