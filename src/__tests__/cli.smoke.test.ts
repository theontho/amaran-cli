import { exec } from 'node:child_process';
import path from 'node:path';

describe('CLI Smoke Test', () => {
  it('should run cli help without error', (done) => {
    const cliPath = path.resolve(__dirname, '../../dist/cli.js');
    exec(`node ${cliPath} --help`, { timeout: 10000 }, (error, stdout, _stderr) => {
      expect(error).toBeNull();
      expect(stdout).toMatch(/Usage|Help|Options/i);
      done();
    });
  }, 15000);
});
