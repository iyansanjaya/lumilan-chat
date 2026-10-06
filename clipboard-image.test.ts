import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { mkdtemp, readdir, readFile, rm, access, stat } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { MAX_CLIPBOARD_IMAGE, stageClipboardImage, inspectClipboardImage } from './clipboard-image.js';

test('clipboard image staging validates bytes, bounds decoding, rejects active formats and cleans private files', async t => {
  const root = await mkdtemp(join(tmpdir(),'lumilan-clipboard-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const image = await sharp({create:{width:20,height:12,channels:4,background:'#ffd36d'}}).png().toBuffer();
  for (const value of [image,image.buffer.slice(image.byteOffset,image.byteOffset+image.byteLength)]) {
    const staged = await stageClipboardImage(value,root);
    assert.deepEqual(await readFile(staged.path),image);
    assert(staged.path.startsWith(root));
    assert.match(staged.path.slice(root.length), /^[\\/]\.clipboard-[A-Za-z0-9]{6}[\\/]Image-\d+\.png$/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(staged.path)).mode & 0o777, 0o600);
      assert.equal((await stat(dirname(staged.path))).mode & 0o777, 0o700);
    }
    await staged.dispose();
    await assert.rejects(access(staged.path));
  }
  for (const value of ['',null,new Uint8Array(),new Uint8Array(MAX_CLIPBOARD_IMAGE+1),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),image.subarray(0,40)])
    await assert.rejects(stageClipboardImage(value,root));
  const oversized = await sharp({create:{width:6400,height:6400,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(stageClipboardImage(oversized,root),/tidak valid|besar/);
  assert.deepEqual(await readdir(root),[],'Rejected image left temporary data');
  for (const format of ['jpeg','webp','gif'] as const) {
    const buffer=await sharp(image)[format]().toBuffer();
    assert.equal((await inspectClipboardImage(buffer)).metadata.format,format);
  }
  const frames=Buffer.alloc(121*3);
  for(let frame=0;frame<121;frame++)frames[frame*3]=frame%2?255:0;
  const animation=await sharp(frames.subarray(0,6),{raw:{width:1,height:2,pageHeight:1,channels:3}}).gif({delay:100,keepDuplicateFrames:true}).toBuffer();
  assert.equal((await inspectClipboardImage(animation)).metadata.pages,2);
  const excessive=await sharp(frames,{raw:{width:1,height:121,pageHeight:1,channels:3}}).gif({delay:100,keepDuplicateFrames:true}).toBuffer();
  await assert.rejects(inspectClipboardImage(excessive),/tidak valid|besar/);
});

test('clipboard staging retains the write error when temporary cleanup also fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lumilan-clipboard-write-failure-'));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#ffd36d' } }).png().toBuffer();
  const writeError = Object.assign(new Error('No space'), { code: 'ENOSPC' });
  t.mock.method(fs, 'writeFile', async () => { throw writeError; });
  t.mock.method(fs, 'rm', async () => { throw Object.assign(new Error('Cleanup denied'), { code: 'EPERM' }); });
  const warning = t.mock.method(console, 'warn', () => {});
  syncBuiltinESMExports();
  try {
    await assert.rejects(stageClipboardImage(png, root), error => error === writeError);
    assert.equal(warning.mock.calls.length, 1);
    assert.equal(warning.mock.calls[0]!.arguments[1], 'EPERM');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
