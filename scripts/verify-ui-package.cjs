const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { extractFile, listPackage } = require('@electron/asar');

const platform = process.platform;
const directory = readdirSync('dist').find(name =>
  platform === 'darwin' ? /^mac(?:-|$)/.test(name) :
  platform === 'linux' ? /^linux.*-unpacked$/.test(name) :
  name === 'win-unpacked'
);
if (!directory) throw new Error(`Packaged app missing for ${platform}`);

const asar = platform === 'darwin'
  ? join('dist', directory, 'Lumilan Chat.app', 'Contents', 'Resources', 'app.asar')
  : join('dist', directory, 'resources', 'app.asar');
const files = new Set(listPackage(asar).map(path => path.replaceAll('\\', '/').replace(/^\/+/, '')));
for (const file of ['main.js', 'preload.cjs', 'peer.js', 'discovery.js', 'preview-image.js', 'public/index.html', 'public/app.css', 'public/app.js', 'public/i18n.js', 'public/message-format.js', 'public/fonts/PublicSans.ttf', 'build/icon.png']) {
  if (!files.has(file)) throw new Error(`Missing ${file} in ${asar}`);
  if (!extractFile(asar, join(...file.split('/'))).equals(readFileSync(file))) throw new Error(`Packaged ${file} differs from source`);
}
const unpacked = join(`${asar}.unpacked`, 'node_modules');
for (const path of [join(unpacked, 'sharp'), join(unpacked, '@img', `sharp-${platform}-${process.arch}`)]) {
  if (!existsSync(path)) throw new Error(`Missing image processor in ${path}`);
}
if (platform !== 'win32' && !existsSync(join(unpacked, '@img', `sharp-libvips-${platform}-${process.arch}`))) {
  throw new Error(`Missing libvips image processor in ${unpacked}`);
}
console.log(`Verified UI in ${asar}`);
