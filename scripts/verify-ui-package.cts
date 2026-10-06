const { existsSync, readFileSync, readdirSync }: typeof import('node:fs') = require('node:fs');
const { join }: typeof import('node:path') = require('node:path');
const { extractFile, listPackage }: typeof import('@electron/asar') = require('@electron/asar');

const dist = process.env.LUMILAN_BUILD_DIR || 'dist';
const platform = process.platform;
const directory = readdirSync(dist).find(name =>
  platform === 'darwin' ? /^mac(?:-|$)/.test(name) :
  platform === 'linux' ? /^linux.*-unpacked$/.test(name) :
  name === 'win-unpacked'
);
if (!directory) throw new Error(`Packaged app missing for ${platform}`);
const asar = platform === 'darwin'
  ? join(dist, directory, 'Lumilan Chat.app', 'Contents', 'Resources', 'app.asar')
  : join(dist, directory, 'resources', 'app.asar');
const files = new Set(listPackage(asar, { isPack: false }).map(path => path.replaceAll('\\', '/').replace(/^\/+/, '')));
const packagedManifest: unknown = JSON.parse(extractFile(asar, 'package.json').toString('utf8'));
if (!packagedManifest || typeof packagedManifest !== 'object' || !('main' in packagedManifest) || packagedManifest.main !== 'out/main.js')
  throw new Error('Packaged entry must be out/main.js');
for (const file of files) {
  if (file.startsWith('node_modules/')) continue;
  if (/\.(?:ts|cts|mts|map)$/.test(file) || /(?:^|\/)\w[^/]*\.test\.[cm]?js$/.test(file) || file.startsWith('out/scripts/'))
    throw new Error(`Development file leaked into package: ${file}`);
  if (/^[^/]+\.[cm]?js$/.test(file) || file.startsWith('public/'))
    throw new Error(`Stale source-layout runtime in package: ${file}`);
}
for (const file of [
  'main.js', 'notch.js', 'linux-screen-lock.js', 'notch-preload.cjs', 'startup-default.js', 'updates.js',
  'preload.cjs', 'peer.js', 'reminders.js', 'discovery.js', 'preview-image.js', 'clipboard-image.js', 'shared/model.js',
  'public/index.html', 'public/notch.html', 'public/notch.css', 'public/notch.js', 'public/app.css', 'public/app.js',
  'public/reminders.js', 'public/avatar.js', 'public/i18n.js', 'public/message-format.js', 'public/voice-call.js',
  'public/fonts/PublicSans.ttf', 'build/icon.png', 'build/icon.ico', 'build/trayTemplate.png', 'build/trayTemplate@2x.png',
]) {
  const entry = `out/${file}`;
  if (!files.has(entry)) throw new Error(`Missing ${entry} in ${asar}`);
  const packed = extractFile(asar, join(...entry.split('/')));
  if (!packed.equals(readFileSync(entry))) throw new Error(`Packaged ${entry} differs from compiled output`);
  if (file === 'preload.cjs' || file === 'notch-preload.cjs') {
    const code = packed.toString('utf8');
    if (/\brequire\(\s*['"](?!electron['"])/.test(code) || /^\s*import\s/m.test(code) || /\b(?:exports|module)\s*(?:[.\[]|,)/.test(code))
      throw new Error(`Sandboxed preload must remain standalone: ${entry}`);
  }
}
const unpacked = join(`${asar}.unpacked`, 'node_modules');
for (const path of [join(unpacked, 'sharp'), join(unpacked, '@img', `sharp-${platform}-${process.arch}`)]) {
  if (!existsSync(path)) throw new Error(`Missing image processor in ${path}`);
}
if (platform !== 'win32' && !existsSync(join(unpacked, '@img', `sharp-libvips-${platform}-${process.arch}`)))
  throw new Error(`Missing libvips image processor in ${unpacked}`);
console.log(`Verified UI in ${asar}`);
if (platform === 'darwin') {
  const resources = join(dist, directory, 'Lumilan Chat.app', 'Contents', 'Resources');
  const iconFile = readdirSync(resources).find(name => name.endsWith('.icns'));
  if (!iconFile) throw new Error('macOS package is missing its application icon');
  const icon = readFileSync(join(resources, iconFile));
  if (icon.length < 8 || icon.toString('ascii', 0, 4) !== 'icns' || icon.readUInt32BE(4) !== icon.length)
    throw new Error('Invalid macOS icon container');
  let png: Buffer | undefined;
  for (let offset = 8; offset + 8 <= icon.length;) {
    const size = icon.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > icon.length) throw new Error('Invalid macOS icon representation');
    if (icon.toString('ascii', offset, offset + 4) === 'ic10') png = icon.subarray(offset + 8, offset + size);
    offset += size;
  }
  if (!png) throw new Error('macOS icon has no 1024px representation');
  const sharp: typeof import('sharp') = require('sharp');
  sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    if (info.width !== 1024 || info.height !== 1024 || data.length !== 1024 * 1024 * 4)
      throw new Error('Incorrect macOS icon resolution');
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++)
      if ((x < 95 || x > 928 || y < 95 || y > 928) && data[(y * 1024 + x) * 4 + 3]! > 8)
        throw new Error('Packaged macOS icon is missing its transparent safe area');
    console.log('Verified macOS icon safe area');
  }).catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
