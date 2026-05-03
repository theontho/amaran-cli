import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const gitHooksDir = join(repoRoot, '.git', 'hooks');
const sourceHooksDir = join(repoRoot, '.githooks');

if (!existsSync(gitHooksDir) || !existsSync(sourceHooksDir)) {
  process.exit(0);
}

mkdirSync(gitHooksDir, { recursive: true });

for (const hookName of ['pre-commit', 'pre-push']) {
  const source = join(sourceHooksDir, hookName);
  const target = join(gitHooksDir, hookName);

  if (!existsSync(source) || !statSync(source).isFile()) continue;

  copyFileSync(source, target);
  chmodSync(target, 0o755);
}
