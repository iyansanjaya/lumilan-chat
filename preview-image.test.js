import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { previewImage } from './preview-image.js';

test('thumbnail lokal memproses PNG, JPEG, WebP di atas 5 MB dan menolak input berbahaya', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumilan-image-'));
  let path = join(dir, 'file');
  const file = name => ({ name, path });
  try {
    for (const format of ['png', 'jpeg', 'webp']) {
      path = join(dir, `file-${format}`);
      writeFileSync(path, await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#6391bc' } }).toFormat(format).toBuffer());
      const name = format === 'jpeg' ? 'foto.JPG' : `foto.${format}`;
      const output = await previewImage(file(name));
      assert.match(output, /^data:image\/webp;base64,/);
      assert.deepEqual(await sharp(Buffer.from(output.split(',')[1], 'base64')).metadata().then(({ width, height }) => [width, height]), [512, 341]);
      assert.ok(existsSync(`${path}.thumb.webp`));
      assert.ok(statSync(`${path}.thumb.webp`).size < 512 * 1024);
      assert.equal(await previewImage(file(name)), output);
      rmSync(`${path}.thumb.webp`);
    }
    await assert.rejects(previewImage(file('animasi.gif')));
    path = join(dir, 'file-spoof');
    writeFileSync(path, await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#6f9e24' } }).png().toBuffer());
    await assert.rejects(previewImage(file('foto.jpg')));
    path = join(dir, 'file-large');
    const noise = randomBytes(1500 * 1500 * 3);
    writeFileSync(path, await sharp(noise, { raw: { width: 1500, height: 1500, channels: 3 } }).png().toBuffer());
    assert.ok(statSync(path).size > 5 * 1024 * 1024);
    assert.match(await previewImage(file('besar.png')), /^data:image\/webp;base64,/);
    rmSync(`${path}.thumb.webp`);
    path = join(dir, 'file-invalid');
    writeFileSync(path, 'bukan gambar');
    await assert.rejects(previewImage(file('rusak.png')));
    truncateSync(path, 100 * 1024 * 1024 + 1);
    await assert.rejects(previewImage(file('terlalu-besar.png')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
