const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { listPackage } = require('@electron/asar');

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
for (const file of ['main.js', 'public/index.html', 'public/app.css', 'public/app.js', 'public/i18n.js', 'public/fonts/PublicSans.ttf']) {
  if (!files.has(file)) throw new Error(`Missing ${file} in ${asar}`);
}
console.log(`Verified UI in ${asar}`);
