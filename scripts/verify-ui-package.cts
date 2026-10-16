const { existsSync, readFileSync, readdirSync }: typeof import('node:fs') = require('node:fs');
const { join, posix }: typeof import('node:path') = require('node:path');
const { extractFile, listPackage }: typeof import('@electron/asar') = require('@electron/asar');
const ts: typeof import('typescript') = require('typescript');

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
if (!packagedManifest || typeof packagedManifest !== 'object' || !('main' in packagedManifest) || packagedManifest.main !== 'out/src/main/main.js')
  throw new Error('Packaged entry must be out/src/main/main.js');
for (const file of files) {
  if (file.startsWith('node_modules/')) continue;
  if (/\.(?:ts|cts|mts|map)$/.test(file) || /(?:^|\/)\w[^/]*\.test\.[cm]?js$/.test(file) || /^out\/(?:scripts|tests)\//.test(file))
    throw new Error(`Development file leaked into package: ${file}`);
  // Uncompiled sources at the archive root, or modules from the pre-src/ compiled layout.
  if (/^[^/]+\.[cm]?js$/.test(file) || /^(?:public|src)\//.test(file) || /^out\/[^/]+\.[cm]?js$/.test(file) || file.startsWith('out/public/'))
    throw new Error(`Stale source-layout runtime in package: ${file}`);
}
const packed = (entry: string) => extractFile(asar, join(...entry.split('/')));
// Pages and assets loaded by path or protocol rather than by import. JavaScript modules are derived below, so a new
// runtime module only needs its build.files entry and can never be packaged without a byte check.
const pages = ['out/src/renderer/index.html', 'out/src/renderer/notch.html'];
for (const entry of [...pages, 'out/src/renderer/app.css', 'out/src/renderer/notch.css', 'out/src/renderer/fonts/PublicSans.ttf',
  'out/src/preload/preload.cjs', 'out/src/preload/notch-preload.cjs',
  'out/build/icon.png', 'out/build/icon.ico', 'out/build/trayTemplate.png', 'out/build/trayTemplate@2x.png'])
  if (!files.has(entry)) throw new Error(`Missing ${entry} in ${asar}`);
// Every packaged compiled file, including those matched by the renderer glob, must be the current build output.
// The archive listing also names directories; any entry that is a parent of another entry is one.
const directories = new Set<string>();
for (const entry of files) for (let at = entry.indexOf('/'); at > 0; at = entry.indexOf('/', at + 1)) directories.add(entry.slice(0, at));
for (const entry of files) {
  if (!entry.startsWith('out/') || directories.has(entry)) continue;
  let compiled: Buffer;
  try { compiled = readFileSync(entry); } catch (error) { throw new Error(`Packaged ${entry} has no compiled counterpart`, { cause: error }); }
  const bytes = packed(entry);
  if (!bytes.equals(compiled)) throw new Error(`Packaged ${entry} differs from compiled output`);
  if (entry.startsWith('out/src/preload/')) {
    const code = bytes.toString('utf8');
    if (/\brequire\(\s*['"](?!electron['"])/.test(code) || /^\s*import\s/m.test(code) || /\b(?:exports|module)\s*(?:[.\[]|,)/.test(code))
      throw new Error(`Sandboxed preload must remain standalone: ${entry}`);
  }
}
// Follow the packaged entry points through their imports: everything the app can load must be in the archive.
// The renderer resolves absolute specifiers against lumilan://app/, which serves out/src/renderer and /reicon/.
function resolveSpecifier(from: string, specifier: string) {
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const target = posix.normalize(posix.join(posix.dirname(from), specifier));
    if (target.startsWith('../')) throw new Error(`Runtime import escapes the package: ${specifier} in ${from}`);
    return target;
  }
  if (specifier.startsWith('/') && /^(?:out\/src\/renderer|node_modules\/reicon)\//.test(from))
    return specifier.startsWith('/reicon/') ? `node_modules/reicon/${specifier.slice('/reicon/'.length)}` : `out/src/renderer${specifier}`;
  return undefined; // Node builtins and packages are installed by electron-builder, not compiled here.
}
const modules = new Set<string>();
function follow(entry: string) {
  if (modules.has(entry)) return;
  if (!files.has(entry)) throw new Error(`Missing ${entry} in ${asar}`);
  modules.add(entry);
  const syntax = ts.createSourceFile(entry, packed(entry).toString('utf8'), ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
  const visit = (node: import('typescript').Node): void => {
    const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const target = resolveSpecifier(entry, specifier.text);
      if (target) follow(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
}
follow('out/src/main/main.js');
for (const page of pages) for (const [, source = ''] of packed(page).toString('utf8').matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g))
  follow(source.startsWith('/') ? `out/src/renderer${source}` : posix.normalize(posix.join(posix.dirname(page), source)));
for (const entry of files) if (/^out\/src\/preload\/[^/]+\.cjs$/.test(entry)) follow(entry);
const unpacked = join(`${asar}.unpacked`, 'node_modules');
for (const path of [join(unpacked, 'sharp'), join(unpacked, '@img', `sharp-${platform}-${process.arch}`)]) {
  if (!existsSync(path)) throw new Error(`Missing image processor in ${path}`);
}
if (platform !== 'win32' && !existsSync(join(unpacked, '@img', `sharp-libvips-${platform}-${process.arch}`)))
  throw new Error(`Missing libvips image processor in ${unpacked}`);
console.log(`Verified UI in ${asar}`);
console.log(`Verified ${modules.size} runtime modules reachable from the packaged entries`);
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
