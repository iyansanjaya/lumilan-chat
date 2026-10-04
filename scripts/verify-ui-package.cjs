const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { extractFile, listPackage } = require('@electron/asar');

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
const files = new Set(listPackage(asar).map(path => path.replaceAll('\\', '/').replace(/^\/+/, '')));
if (!files.has('clipboard-image.js') || !extractFile(asar, 'clipboard-image.js').equals(readFileSync('clipboard-image.js'))) {
  throw new Error(`Missing or stale clipboard image validator in ${asar}`);
}
if (!files.has('linux-screen-lock.js') || !extractFile(asar, 'linux-screen-lock.js').equals(readFileSync('linux-screen-lock.js'))) {
  throw new Error(`Missing or stale Linux lock detector in ${asar}`);
}
for (const file of ['main.js', 'notch.js', 'notch-preload.cjs', 'startup-default.js', 'preload.cjs', 'peer.js', 'reminders.js', 'discovery.js', 'preview-image.js', 'public/index.html', 'public/notch.html', 'public/notch.css', 'public/notch.js', 'public/app.css', 'public/app.js', 'public/reminders.js', 'public/avatar.js', 'public/i18n.js', 'public/message-format.js', 'public/voice-call.js', 'public/fonts/PublicSans.ttf', 'build/icon.png']) {
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
if (platform === 'darwin') {
  const resources=join(dist,directory,'Lumilan Chat.app','Contents','Resources');
  const iconFile=readdirSync(resources).find(name=>name.endsWith('.icns'));
  if(!iconFile)throw new Error('macOS package is missing its application icon');
  const icon=readFileSync(join(resources,iconFile));
  if(icon.toString('ascii',0,4)!=='icns'||icon.readUInt32BE(4)!==icon.length)throw new Error('Invalid macOS icon container');
  let png;
  for(let offset=8;offset+8<=icon.length;){
    const size=icon.readUInt32BE(offset+4);
    if(size<8||offset+size>icon.length)throw new Error('Invalid macOS icon representation');
    if(icon.toString('ascii',offset,offset+4)==='ic10')png=icon.subarray(offset+8,offset+size);
    offset+=size;
  }
  if(!png)throw new Error('macOS icon has no 1024px representation');
  require('sharp')(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}).then(({data,info})=>{
    if(info.width!==1024||info.height!==1024)throw new Error('Incorrect macOS icon resolution');
    for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if((x<95||x>928||y<95||y>928)&&data[(y*1024+x)*4+3]>8)
      throw new Error('Packaged macOS icon is missing its transparent safe area');
    console.log('Verified macOS icon safe area');
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
