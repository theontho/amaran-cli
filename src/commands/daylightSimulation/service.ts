import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import type { Command } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import type { CommandDeps, CommandOptions } from '../../daylightSimulation/types.js';

export function registerService(program: Command, deps: CommandDeps) {
  const { asyncCommand } = deps;

  const serviceCommand = program
    .command('service')
    .description('Manage auto-cct circadian lighting background service');

  // Install service
  serviceCommand
    .command('install')
    .description('Install auto-cct as a circadian lighting background service (runs every minute)')
    .option('-i, --interval <seconds>', 'Interval in seconds (default: 60)', '60')
    .option(
      '-C, --curve <curve>',
      'Curve type for CCT calculation (hann, wider-middle-small, wider-middle-medium, wider-middle-large, cie-daylight, sun-altitude, perez-daylight, default: hann)',
      'hann'
    )
    .action(asyncCommand(handleInstall(deps)));

  // Uninstall service
  serviceCommand
    .command('uninstall')
    .description('Uninstall circadian lighting background service')
    .action(asyncCommand(handleUninstall()));

  // Status command
  serviceCommand
    .command('status')
    .description('Check circadian lighting service status')
    .action(asyncCommand(handleStatus()));

  // Start service
  serviceCommand.command('start').description('Start circadian lighting service').action(asyncCommand(handleStart()));

  // Stop service
  serviceCommand.command('stop').description('Stop circadian lighting service').action(asyncCommand(handleStop()));

  // Logs command
  serviceCommand
    .command('logs')
    .description('Show circadian lighting service logs')
    .option('-f, --follow', 'Follow log output')
    .option('-e, --errors', 'Show error logs instead')
    .action(asyncCommand(handleLogs()));
}

function handleInstall(_deps: CommandDeps) {
  return async (options: CommandOptions) => {
    // dynamic import for ESM
    const { parseCurveType } = await import('../../daylightSimulation/cctUtil.js');

    const interval = parseInt(options.interval ?? '60', 10);
    if (Number.isNaN(interval) || interval < 10) {
      console.error(chalk.red('Interval must be at least 10 seconds'));
      process.exit(1);
    }

    // Validate curve option
    let curveType: string;
    if (options.curve) {
      try {
        curveType = parseCurveType(options.curve);
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    } else {
      curveType = 'HANN';
    }

    // Determine CLI path - check if globally installed or local
    let cliPath: string;
    let isGlobal = false;

    // Check if running from global installation
    try {
      const { stdout } = await runCommand('which', ['amaran-cli']);
      const globalPath = stdout.trim();
      if (globalPath && fs.existsSync(globalPath)) {
        cliPath = globalPath;
        isGlobal = true;
        console.log(chalk.blue(`✓ Detected global installation: ${cliPath}`));
      } else {
        throw new Error('Not found in PATH');
      }
    } catch {
      // Fall back to local development path
      const projectDir = path.resolve(__dirname, '..');
      cliPath = path.join(projectDir, 'dist', 'cli.js');

      // Check if CLI is built locally
      if (!fs.existsSync(cliPath)) {
        console.error(chalk.red('CLI not found. Please either:'));
        console.error(chalk.red('  1. Install globally: npm install -g .'));
        console.error(chalk.red('  2. Or build locally: npm run build'));
        process.exit(1);
      }
      console.log(chalk.blue(`✓ Using local development build: ${cliPath}`));
    }

    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error(chalk.red('HOME environment variable not set'));
      process.exit(1);
    }

    const plistName = 'com.hmmfn.amaran.circadian-service';
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${plistName}.plist`);
    const logDir = path.join(homeDir, 'Library', 'Logs');
    const nodePath = process.execPath;

    // Ensure log directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plistName}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${cliPath}</string>
        <string>auto-cct</string>
        <string>--curve</string>
        <string>${curveType}</string>
    </array>
    <key>StartInterval</key>
    <integer>${interval}</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'amaran-circadian-service.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'amaran-circadian-service-error.log')}</string>
    ${
      !isGlobal
        ? `<key>WorkingDirectory</key>
    <string>${path.dirname(path.dirname(cliPath))}</string>`
        : ''
    }
</dict>
</plist>`;

    try {
      // Write plist file
      fs.writeFileSync(plistPath, plistContent);
      console.log(chalk.green(`✓ Created service file: ${plistPath}`));

      // Load the service
      await runCommand('launchctl', ['load', plistPath]);
      console.log(chalk.green(`✓ Circadian lighting service installed and started`));
      console.log(chalk.blue(`  Installation type: ${isGlobal ? 'Global' : 'Local development'}`));
      console.log(chalk.blue(`  CLI path: ${cliPath}`));
      console.log(chalk.blue(`  Running auto-cct every ${interval} seconds`));
      console.log(chalk.blue(`  Curve type: ${curveType}`));
      console.log(chalk.gray(`  Logs: ${path.join(logDir, 'amaran-circadian-service.log')}`));
      console.log(chalk.gray(`  Errors: ${path.join(logDir, 'amaran-circadian-service-error.log')}`));
      appendServiceLog(`Service installed (${isGlobal ? 'global' : 'local'}) interval=${interval}s curve=${curveType}`);
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to install circadian lighting service:'), err.message);
      process.exit(1);
    }
  };
}

function handleUninstall() {
  return async () => {
    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error(chalk.red('HOME environment variable not set'));
      process.exit(1);
    }

    const plistName = 'com.hmmfn.amaran.circadian-service';
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${plistName}.plist`);

    try {
      if (fs.existsSync(plistPath)) {
        // Unload the service
        await runCommand('launchctl', ['unload', plistPath]);
        // Remove the plist file
        fs.unlinkSync(plistPath);
        console.log(chalk.green('✓ Circadian lighting service uninstalled successfully'));
        appendServiceLog('Service uninstalled');
      } else {
        console.log(chalk.yellow('Circadian lighting service not found (already uninstalled)'));
      }
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to uninstall circadian lighting service:'), err.message);
      process.exit(1);
    }
  };
}

function handleStatus() {
  return async () => {
    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error(chalk.red('HOME environment variable not set'));
      process.exit(1);
    }

    const plistName = 'com.hmmfn.amaran.circadian-service';
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${plistName}.plist`);
    const logPath = path.join(homeDir, 'Library', 'Logs', 'amaran-circadian-service.log');
    const errorLogPath = path.join(homeDir, 'Library', 'Logs', 'amaran-circadian-service-error.log');

    try {
      if (!fs.existsSync(plistPath)) {
        console.log(chalk.yellow('Circadian lighting service not installed'));
        return;
      }

      // Check if service is loaded
      const { stdout } = await runCommand('launchctl', ['list']);
      const isLoaded = stdout.includes(plistName);

      console.log(chalk.blue('Circadian Lighting Service Status:'));
      console.log(`  Installed: ${chalk.green('✓')}`);
      console.log(`  Running: ${isLoaded ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Config: ${plistPath}`);

      if (fs.existsSync(logPath)) {
        const logStats = fs.statSync(logPath);
        console.log(`  Last run: ${logStats.mtime.toLocaleString()}`);

        // Show last few lines of log
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lastLines = logContent.trim().split('\n').slice(-3);
        if (lastLines.length > 0 && lastLines[0]) {
          console.log(chalk.gray('  Recent output:'));
          for (const line of lastLines) {
            console.log(chalk.gray(`    ${line}`));
          }
        }
      }

      if (fs.existsSync(errorLogPath)) {
        const errorContent = fs.readFileSync(errorLogPath, 'utf8').trim();
        if (errorContent) {
          console.log(chalk.red('  Recent errors:'));
          errorContent
            .split('\n')
            .slice(-3)
            .forEach((line) => {
              if (line.trim()) console.log(chalk.red(`    ${line}`));
            });
        }
      }
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to check circadian lighting service status:'), err.message);
    }
  };
}

function handleStart() {
  return async () => {
    const plistName = 'com.hmmfn.amaran.circadian-service';
    try {
      await runCommand('launchctl', ['start', plistName]);
      console.log(chalk.green('✓ Circadian lighting service started'));
      appendServiceLog('Service start requested');
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to start circadian lighting service:'), err.message);
    }
  };
}

function handleStop() {
  return async () => {
    const plistName = 'com.hmmfn.amaran.circadian-service';
    try {
      await runCommand('launchctl', ['stop', plistName]);
      console.log(chalk.green('✓ Circadian lighting service stopped'));
      appendServiceLog('Service stop requested');
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to stop circadian lighting service:'), err.message);
    }
  };
}

function handleLogs() {
  return async (options: CommandOptions) => {
    const homeDir = process.env.HOME;
    if (!homeDir) {
      console.error(chalk.red('HOME environment variable not set'));
      process.exit(1);
    }

    const logFile = options.errors ? 'amaran-circadian-service-error.log' : 'amaran-circadian-service.log';
    const logPath = path.join(homeDir, 'Library', 'Logs', logFile);

    if (!fs.existsSync(logPath)) {
      console.log(chalk.yellow(`No ${options.errors ? 'error ' : ''}logs found`));
      return;
    }

    try {
      if (options.follow) {
        console.log(chalk.blue(`Following ${logFile}... (Ctrl+C to stop)`));
        spawn('tail', ['-f', logPath], { stdio: 'inherit' });
      } else {
        const content = fs.readFileSync(logPath, 'utf8');
        console.log(content);
      }
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red('Failed to read logs:'), err.message);
    }
  };
}

function appendServiceLog(message: string): void {
  const homeDir = process.env.HOME;
  if (!homeDir) {
    return;
  }
  const logDir = path.join(homeDir, 'Library', 'Logs');
  const logPath = path.join(logDir, 'amaran-circadian-service.log');
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch (error) {
    const err = error as Error;
    console.error(chalk.red('Failed to write to service log:'), err.message);
  }
}

// Helper function to run shell commands
function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

export default registerService;
