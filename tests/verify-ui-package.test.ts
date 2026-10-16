import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { record } from '../src/shared/model.js';

const source = readFileSync(new URL('../scripts/verify-ui-package.cjs', import.meta.url), 'utf8');
const manifest = record(record(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))).build);
const sourceFiles = new Map<string, Buffer>();
function addSource(file: string): void {
  sourceFiles.set(file, readFileSync(new URL(`../../${file}`, import.meta.url)));
}
assert(Array.isArray(manifest.files));
for (const file of manifest.files) {
  assert.equal(typeof file, 'string');
  if (typeof file === 'string' && !file.includes('*') && !file.startsWith('!')) addSource(file);
}
function addDirectory(directory: string): void {
  for (const entry of readdirSync(new URL(`../../${directory}/`, import.meta.url), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) addDirectory(file);
    else if (!file.endsWith('.map')) addSource(file);
  }
}
addDirectory('out/src/renderer');
for (const file of ['out/build/trayTemplate.png', 'out/build/trayTemplate@2x.png']) addSource(file);
// Icons the renderer imports through lumilan://app/reicon/ are packaged dependency modules.
addSource('node_modules/reicon/createIcon.js');
for (const [file, bytes] of [...sourceFiles]) if (file.startsWith('out/src/renderer/') && file.endsWith('.js'))
  for (const [, icon = ''] of bytes.toString('utf8').matchAll(/from '\/reicon\/([^']+)'/g)) addSource(`node_modules/reicon/${icon}`);

type Platform = 'win32' | 'darwin' | 'linux';
type Options = { updates?: 'current' | 'missing' | 'stale'; missingNative?: number; badSafeArea?: boolean; extra?: string; main?: string; preloadDependency?: boolean; preloadWrapper?: boolean;
  packaged?: Record<string, string | null>; local?: Record<string, string> };
async function verify(platform: Platform, arch: string, { updates = 'current', missingNative, badSafeArea = false, extra, main, preloadDependency = false, preloadWrapper = false, packaged: packagedChanges = {}, local = {} }: Options = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const directory = platform === 'win32' ? 'win-unpacked' : platform === 'darwin' ? `mac-${arch}` : `linux-${arch}-unpacked`;
  const resources = platform === 'darwin'
    ? path.join('fixture', directory, 'Lumilan Chat.app', 'Contents', 'Resources')
    : path.join('fixture', directory, 'resources');
  const archive = path.join(resources, 'app.asar');
  const unpacked = path.join(`${archive}.unpacked`, 'node_modules');
  const native = [path.join(unpacked, 'sharp'), path.join(unpacked, '@img', `sharp-${platform}-${arch}`)];
  if (platform !== 'win32') native.push(path.join(unpacked, '@img', `sharp-libvips-${platform}-${arch}`));
  const localSources = new Map(sourceFiles);
  const packaged = new Map(sourceFiles);
  if (updates === 'missing') packaged.delete('out/src/main/updates.js');
  if (updates === 'stale') packaged.set('out/src/main/updates.js', Buffer.from('stale update module'));
  if (extra) packaged.set(extra, Buffer.from('unexpected file'));
  if (main) packaged.set('package.json', Buffer.from(JSON.stringify({ main })));
  if (preloadDependency || preloadWrapper) {
    const code = Buffer.from(preloadWrapper ? `Object.defineProperty(exports, '__esModule', {value:true});` : `require('./shared.cjs');`);
    packaged.set('out/src/preload/preload.cjs', code); localSources.set('out/src/preload/preload.cjs', code);
  }
  for (const [file, value] of Object.entries(packagedChanges)) {
    if (value === null) packaged.delete(file);
    else packaged.set(file, Buffer.from(value));
  }
  for (const [file, value] of Object.entries(local)) localSources.set(file, Buffer.from(value));
  const png = Buffer.from('1024px PNG fixture');
  const icon = Buffer.alloc(16 + png.length);
  icon.write('icns'); icon.writeUInt32BE(icon.length, 4);
  icon.write('ic10', 8); icon.writeUInt32BE(8 + png.length, 12); png.copy(icon, 16);
  const reads: string[] = [], nativeChecks: string[] = [], logs: string[] = [], errors: string[] = [];
  const process = { platform, arch, env: { LUMILAN_BUILD_DIR: 'fixture' }, exitCode: 0 };
  runInNewContext(source, {
    process, exports: {},
    console: { log: (value: string) => logs.push(value), error: (value: string) => errors.push(value) },
    require: (name: string) => {
      if (name === 'node:path') return path;
      if (name === 'typescript') return ts;
      if (name === 'node:fs') return {
        readdirSync: (directoryPath: string) => {
          if (directoryPath === 'fixture') return ['unrelated', directory];
          assert.equal(directoryPath, resources);
          return ['icon.icns'];
        },
        readFileSync: (file: string) => {
          if (file === path.join(resources, 'icon.icns')) return icon;
          const value = localSources.get(file.replaceAll('\\', '/'));
          assert(value, `Unexpected source read: ${file}`);
          return value;
        },
        existsSync: (file: string) => {
          nativeChecks.push(file);
          assert(native.includes(file), `Unexpected native module: ${file}`);
          return missingNative === undefined || file !== native[missingNative];
        },
      };
      if (name === '@electron/asar') return {
        listPackage: (file: string) => {
          assert.equal(file, archive);
          return [...packaged.keys()].map(file => platform === 'win32' ? `\\${file.replaceAll('/', '\\')}` : `/${file}`);
        },
        extractFile: (file: string, entry: string) => {
          assert.equal(file, archive);
          const key = entry.replaceAll('\\', '/');
          reads.push(key);
          const value = packaged.get(key);
          assert(value, `Unexpected archive read: ${key}`);
          return value;
        },
      };
      if (name === 'sharp') return (bytes: Buffer) => {
        assert(bytes.equals(png));
        const decoder = {
          ensureAlpha: () => decoder, raw: () => decoder,
          toBuffer: (options: { resolveWithObject: boolean }) => {
            assert.equal(options.resolveWithObject, true);
            const data = Buffer.alloc(1024 * 1024 * 4);
            if (badSafeArea) data[3] = 255;
            return Promise.resolve({ data, info: { width: 1024, height: 1024 } });
          },
        };
        return decoder;
      };
      throw new Error(`Unexpected verifier dependency: ${name}`);
    },
  }, { filename: 'out/scripts/verify-ui-package.cjs' });
  await new Promise<void>(resolve => setImmediate(resolve));
  return { process, reads, nativeChecks, native, logs, errors };
}

const platforms: [Platform, string][] = [['win32', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']];
test('package verifier rejects missing or stale updates on every supported build platform', async () => {
  for (const [platform, arch] of platforms) {
    const current = await verify(platform, arch);
    assert.equal(current.process.exitCode, 0);
    assert.deepEqual(current.errors, []);
    await assert.rejects(verify(platform, arch, { updates: 'missing' }), /Missing out\/src\/main\/updates\.js in /);
    await assert.rejects(verify(platform, arch, { updates: 'stale' }), /Packaged out\/src\/main\/updates\.js differs from compiled output/);
    assert(current.reads.includes('out/src/main/updates.js'), `${platform}/${arch} never compared updates.js`);
    assert.deepEqual(current.nativeChecks, current.native);
    assert(current.logs.some(value => value.startsWith('Verified UI in ')));
    await assert.rejects(verify(platform, arch, { missingNative: 1 }), /Missing image processor in /);
    if (platform !== 'win32') await assert.rejects(verify(platform, arch, { missingNative: 2 }), /Missing libvips image processor in /);
    if (platform === 'darwin') {
      assert(current.logs.includes('Verified macOS icon safe area'));
      const unsafe = await verify(platform, arch, { badSafeArea: true });
      assert.equal(unsafe.process.exitCode, 1);
      assert.deepEqual(unsafe.errors, ['Packaged macOS icon is missing its transparent safe area']);
    }
  }
});
test('package verifier enforces compiled entry, production contents, and standalone sandbox preloads', async () => {
  for (const [platform, arch] of platforms) {
    for (const main of ['main.js', 'out/main.js'])
      await assert.rejects(verify(platform, arch, { main }), /entry must be out\/src\/main\/main\.js/);
    for (const extra of ['out/src/main/main.ts', 'out/src/renderer/app.js.map', 'out/tests/peer.test.js', 'out/tests/fixture.js', 'out/scripts/build.js'])
      await assert.rejects(verify(platform, arch, { extra }), /Development file leaked/);
    for (const extra of ['main.js', 'preload.cjs', 'public/app.js', 'src/main/main.js', 'out/main.js', 'out/public/app.js'])
      await assert.rejects(verify(platform, arch, { extra }), /Stale source-layout runtime/);
    await assert.rejects(verify(platform, arch, { preloadDependency: true }), /Sandboxed preload must remain standalone/);
    await assert.rejects(verify(platform, arch, { preloadWrapper: true }), /Sandboxed preload must remain standalone/);
  }
});
const compiledText = (file: string) => { const value = sourceFiles.get(file); assert(value, `Missing fixture ${file}`); return value.toString('utf8'); };
const mainWith = (line: string) => `${compiledText('out/src/main/main.js')}\n${line}\n`;
test('package verifier derives runtime modules from the packaged entries instead of a hand-kept list', async () => {
  for (const [platform, arch] of platforms) {
    const baseline = await verify(platform, arch);
    const counted = (logs: string[]) => Number(/^Verified (\d+) runtime modules/.exec(logs.find(value => value.startsWith('Verified ') && value.includes('runtime modules')) || '')?.[1]);
    assert(counted(baseline.logs) > 20, `${platform}/${arch} did not follow the packaged import graph`);
    const main = mainWith("import './late-module.js';"), late = 'export const late = 1;\n';
    const added = await verify(platform, arch, { packaged: { 'out/src/main/main.js': main, 'out/src/main/late-module.js': late }, local: { 'out/src/main/main.js': main, 'out/src/main/late-module.js': late } });
    assert.equal(added.process.exitCode, 0);
    assert(added.reads.includes('out/src/main/late-module.js'), 'A new runtime module was packaged without a byte check');
    assert.equal(counted(added.logs), counted(baseline.logs) + 1);
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/main/main.js': main }, local: { 'out/src/main/main.js': main, 'out/src/main/late-module.js': late } }),
      /Missing out\/src\/main\/late-module\.js in /, 'A module missing from build.files was not detected');
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/main/main.js': main, 'out/src/main/late-module.js': 'export const late = 2;\n' }, local: { 'out/src/main/main.js': main, 'out/src/main/late-module.js': late } }),
      /Packaged out\/src\/main\/late-module\.js differs from compiled output/);
    const lazy = mainWith("export const lazy = () => import('./lazy-module.js');");
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/main/main.js': lazy }, local: { 'out/src/main/main.js': lazy } }), /Missing out\/src\/main\/lazy-module\.js in /, 'Dynamic imports were not followed');
    const escaping = mainWith("import '../../../../outside.js';");
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/main/main.js': escaping }, local: { 'out/src/main/main.js': escaping } }), /Runtime import escapes the package/);
  }
});
test('package verifier follows renderer pages, cross-process imports and icons, and byte-checks glob-packaged files', async () => {
  const icon = [...sourceFiles.keys()].find(file => file.startsWith('node_modules/reicon/icons/'));
  assert(icon, 'Renderer fixture imports no reicon icons');
  for (const [platform, arch] of platforms) {
    for (const missing of ['out/src/renderer/notch.js', 'out/src/renderer/avatar.js', 'out/src/renderer/i18n.js', icon, 'node_modules/reicon/createIcon.js'])
      await assert.rejects(verify(platform, arch, { packaged: { [missing]: null } }), new RegExp(`Missing ${missing.replaceAll('/', '\/').replaceAll('.', '\.')} in `), `${missing} was not required`);
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/renderer/panel.js': 'export const panel = 2;\n' }, local: { 'out/src/renderer/panel.js': 'export const panel = 1;\n' } }),
      /Packaged out\/src\/renderer\/panel\.js differs from compiled output/, 'A renderer file packaged through the glob escaped the byte check');
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/main/orphan.js': 'export {};\n' } }), /Packaged out\/src\/main\/orphan\.js has no compiled counterpart/);
    await assert.rejects(verify(platform, arch, { packaged: { 'out/src/renderer/app.css': null } }), /Missing out\/src\/renderer\/app\.css in /);
  }
});
