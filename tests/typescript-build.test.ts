import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { record } from '../src/shared/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'out');
test('all authored JavaScript is migrated and each TypeScript source has compiled output', () => {
  for (const directory of ['', 'src/main', 'src/preload', 'src/renderer', 'src/shared', 'scripts', 'tests']) {
    for (const file of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (!file.isFile()) continue;
      assert(!/\.[cm]?js$/.test(file.name), `Unmigrated source: ${directory}/${file.name}`);
      if (/\.d\.ts$/.test(file.name) || !/\.[cm]?ts$/.test(file.name)) continue;
      const emitted = file.name.replace(/\.cts$/, '.cjs').replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js');
      assert(existsSync(join(output, directory, emitted)), `Missing emitted module: ${directory}/${emitted}`);
    }
  }
});
test('packaged main and renderer module graphs resolve to allowlisted compiled files', () => {
  const manifest = record(record(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))).build);
  assert(Array.isArray(manifest.files));
  const allowlist = manifest.files.filter((file: unknown): file is string => typeof file === 'string' && !file.includes('*'));
  const visited = new Set<string>();
  function visit(file: string): void {
    if (visited.has(file)) return;
    visited.add(file);
    assert(existsSync(join(root, file)), `Missing runtime import: ${file}`);
    assert(file.startsWith('out/src/renderer/') || allowlist.includes(file), `Runtime module absent from package allowlist: ${file}`);
    const syntax = ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    for (const node of syntax.statements) {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      if (specifier.text.startsWith('.')) {
        const target = resolve(root, dirname(file), specifier.text);
        assert(target.startsWith(output + sep), 'Runtime import escaped compiled output');
        visit(target.slice(root.length + 1).replaceAll('\\', '/'));
      } else if (file.startsWith('out/src/renderer/')) assert(specifier.text.startsWith('/reicon/icons/'), `Unexpected renderer module: ${specifier.text}`);
    }
  }
  visit('out/src/main/main.js');
  visit('out/src/renderer/app.js');
  visit('out/src/renderer/notch.js');
  assert(visited.has('out/src/shared/model.js'));
});
test('renderer compiler rejects Node privileges without weakening strict checks', () => {
  const temporaryRoot = join(root, '.bun-task-temp');
  mkdirSync(temporaryRoot, { recursive: true });
  const temporary = mkdtempSync(join(temporaryRoot, 'type-boundary-'));
  try {
    const fixture = join(temporary, 'renderer.mts');
    writeFileSync(fixture, 'process.pid; require("node:fs"); document.createElement("div");');
    writeFileSync(join(temporary, 'tsconfig.json'), JSON.stringify({
      extends: join(root, 'tsconfig.renderer.json'), include: [fixture], exclude: [],
    }));
    const result = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(temporary, 'tsconfig.json')], { encoding: 'utf8' });
    if (result.error) throw result.error;
    assert.equal(result.status, 2);
    assert.match(result.stdout, /Cannot find name 'process'/);
    assert.match(result.stdout, /Cannot find name 'require'/);
    assert(!result.stdout.includes("Cannot find name 'document'"));
    const config = record(record(JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))).compilerOptions);
    for (const option of ['strict', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'useUnknownInCatchVariables', 'noEmitOnError'])
      assert.equal(config[option], true, `${option} must remain enabled`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
