import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'out');
function run(args: string[]): void {
  // Bun's Windows spawn inherits its startup environment unless env is explicit.
  const result = spawnSync('node', args, { cwd: root, stdio: 'inherit', env: { ...process.env } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed with status ${result.status ?? 1}: node ${args.join(' ')}`);
}
const compiler = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const check = () => {
  for (const config of ['tsconfig.json', 'tsconfig.desktop.json', 'tsconfig.renderer.json', 'tsconfig.preload.json'])
    run([compiler, '-p', config, '--noEmit']);
};
const mode = process.argv[2] ?? 'build';
if (mode === 'check') { check(); process.exit(0); }
if (mode !== 'build' && mode !== 'test' && mode !== 'large') throw new Error(`Unknown build mode: ${mode}`);
// Never follow a junction/symlink while cleaning generated files.
if (existsSync(output) && realpathSync(output) !== output) throw new Error('Refusing to clean redirected build output');
rmSync(output, { recursive: true, force: true });
check();
run([compiler, '-p', 'tsconfig.json']);
for (const asset of ['index.html', 'notch.html', 'app.css', 'notch.css', 'fonts'])
  cpSync(join(root, 'public', asset), join(output, 'public', asset), { recursive: true });
mkdirSync(join(output, 'build'), { recursive: true });
for (const asset of ['icon.png', 'icon.ico', 'trayTemplate.png', 'trayTemplate@2x.png'])
  cpSync(join(root, 'build', asset), join(output, 'build', asset));
if (mode === 'test' || mode === 'large') {
  const tests = readdirSync(output).filter(name => name.endsWith('.test.js')).sort();
  if (!tests.length) throw new Error('Compiled tests missing');
  const temporaryRoot = join(root, '.bun-task-temp');
  mkdirSync(temporaryRoot, { recursive: true });
  if (mode === 'large') {
    // Measure disk space with the Node runtime that performs the transfer.
    run(['-e', `const disk = require('node:fs').statfsSync(process.argv[1], { bigint: true });
      const available = disk.bavail * disk.bsize;
      console.log('Full 5 GB verification workspace free: ' + available + ' bytes');
      if (available < 16n * 1024n ** 3n)
        throw new Error('Full 5 GB verification requires at least 16 GiB free on the workspace drive');`, temporaryRoot]);
  }
  const temporary = mkdtempSync(join(temporaryRoot, 'typescript-test-'));
  // Redirect only this test process and its children; never reuse user profiles.
  process.env.TMPDIR = temporary; process.env.TEMP = temporary; process.env.TMP = temporary;
  if (mode === 'large') process.env.LUMILAN_TEST_5GB = '1';
  try {
    run([...(mode === 'large' ? ['--max-old-space-size=256'] : []), '--test', ...tests.filter(name => mode !== 'large' || name === 'peer.large.test.js').map(name => join(output, name))]);
  } finally { rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}
