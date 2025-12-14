import { exec } from 'node:child_process';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('CLI Smoke Test', () => {
  const runTest = process.platform === 'darwin' ? it : it.skip;

  runTest(
    'should run cli help without error - macOS only',
    async () => {
      const cliPath = path.resolve(__dirname, '../../dist/cli.js');
      // We use a promise wrapper for exec to use async/await
      // biome-ignore lint/suspicious/noExplicitAny: opts type matches exec options
      const execPromise = (cmd: string, opts: any) =>
        new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(cmd, opts, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
          });
        });

      const { stdout } = await execPromise(`node ${cliPath} --help`, { timeout: 10000 });
      expect(stdout).toMatch(/Usage|Help|Options/i);
    },
    15000
  );
});
