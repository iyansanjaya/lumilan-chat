import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./scripts/verify-ui-package.cjs', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const sourceFiles = new Map();
function addSource(file) {
  sourceFiles.set(file, readFileSync(new URL(file, import.meta.url)));
}
for (const file of manifest.build.files.filter(file => !file.includes('*'))) addSource(file);
function addPublic(directory) {
  for (const entry of readdirSync(new URL(`${directory}/`, import.meta.url), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) addPublic(file);
    else addSource(file);
  }
}
addPublic('public');

async function verify(platform, arch, { updates = 'current', missingNative, badSafeArea = false } = {}) {
  const path = platform === 'win32' ? win32 : posix;
  const directory = platform === 'win32' ? 'win-unpacked' : platform === 'darwin' ? `mac-${arch}` : `linux-${arch}-unpacked`;
  const resources = platform === 'darwin'
    ? path.join('fixture', directory, 'Lumilan Chat.app', 'Contents', 'Resources')
    : path.join('fixture', directory, 'resources');
  const archive = path.join(resources, 'app.asar');
  const unpacked = path.join(`${archive}.unpacked`, 'node_modules');
  const native = [path.join(unpacked, 'sharp'), path.join(unpacked, '@img', `sharp-${platform}-${arch}`)];
  if (platform !== 'win32') native.push(path.join(unpacked, '@img', `sharp-libvips-${platform}-${arch}`));
  const packaged = new Map(sourceFiles);
  if (updates === 'missing') packaged.delete('updates.js');
  if (updates === 'stale') packaged.set('updates.js', Buffer.from('stale update module'));
  const png = Buffer.from('1024px PNG fixture');
  const icon = Buffer.alloc(16 + png.length);
  icon.write('icns'); icon.writeUInt32BE(icon.length, 4);
  icon.write('ic10', 8); icon.writeUInt32BE(8 + png.length, 12); png.copy(icon, 16);
  const reads = [], nativeChecks = [], logs = [], errors = [];
  const process = { platform, arch, env: { LUMILAN_BUILD_DIR: 'fixture' }, exitCode: 0 };
  runInNewContext(source, {
    process,
    console: { log: value => logs.push(value), error: value => errors.push(value) },
    require: name => {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return {
        readdirSync: directoryPath => {
          if (directoryPath === 'fixture') return ['unrelated', directory];
          assert.equal(directoryPath, resources);
          return ['icon.icns'];
        },
        readFileSync: file => {
          if (file === path.join(resources, 'icon.icns')) return icon;
          const value = sourceFiles.get(file.replaceAll('\\', '/'));
          assert(value, `Unexpected source read: ${file}`);
          return value;
        },
        existsSync: file => {
          nativeChecks.push(file);
          assert(native.includes(file), `Unexpected native module: ${file}`);
          return file !== native[missingNative];
        },
      };
      if (name === '@electron/asar') return {
        listPackage: file => {
          assert.equal(file, archive);
          return [...packaged.keys()].map(file => platform === 'win32' ? `\\${file.replaceAll('/', '\\')}` : `/${file}`);
        },
        extractFile: (file, entry) => {
          assert.equal(file, archive);
          const key = entry.replaceAll('\\', '/');
          reads.push(key);
          assert(packaged.has(key), `Unexpected archive read: ${key}`);
          return packaged.get(key);
        },
      };
      if (name === 'sharp') return bytes => {
        assert(bytes.equals(png));
        const decoder = {
          ensureAlpha: () => decoder, raw: () => decoder,
          toBuffer: options => {
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
  }, { filename: 'scripts/verify-ui-package.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  return { process, reads, nativeChecks, native, logs, errors };
}

test('package verifier rejects missing or stale updates on every supported build platform', async () => {
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'x64'], ['linux', 'arm64']]) {
    const current = await verify(platform, arch);
    assert.equal(current.process.exitCode, 0);
    assert.deepEqual(current.errors, []);
    await assert.rejects(verify(platform, arch, { updates: 'missing' }), /Missing updates\.js in /);
    await assert.rejects(verify(platform, arch, { updates: 'stale' }), /Packaged updates\.js differs from source/);
    assert(current.reads.includes('updates.js'), `${platform}/${arch} never compared updates.js`);
    assert.deepEqual(current.nativeChecks, current.native);
    assert(current.logs.some(value => value.startsWith('Verified UI in ')));
    await assert.rejects(verify(platform, arch, { missingNative: 1 }), /Missing image processor in /);
    if (platform !== 'win32')
      await assert.rejects(verify(platform, arch, { missingNative: 2 }), /Missing libvips image processor in /);
    if (platform === 'darwin') {
      assert(current.logs.includes('Verified macOS icon safe area'));
      const unsafe = await verify(platform, arch, { badSafeArea: true });
      assert.equal(unsafe.process.exitCode, 1);
      assert.deepEqual(unsafe.errors, ['Packaged macOS icon is missing its transparent safe area']);
    }
  }
});
