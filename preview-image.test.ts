import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { previewImage } from './preview-image.js';

test('thumbnail lokal memproses PNG, JPEG, WebP, GIF bergerak, dan menolak input berbahaya', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumilan-image-'));
  let path = join(dir, 'file');
  const file = (name: string) => ({ name, path });
  try {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      path = join(dir, `file-${format}`);
      writeFileSync(path, await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#6391bc' } }).toFormat(format).toBuffer());
      const name = format === 'jpeg' ? 'foto.JPG' : `foto.${format}`;
      const output = await previewImage(file(name));
      assert.match(output, /^data:image\/webp;base64,/);
      assert.deepEqual(await sharp(Buffer.from(output.split(',')[1]!, 'base64')).metadata().then(({ width, height }) => [width, height]), [512, 341]);
      assert.ok(existsSync(`${path}.thumb.webp`));
      assert.ok(statSync(`${path}.thumb.webp`).size < 512 * 1024);
      assert.equal(await previewImage(file(name)), output);
      rmSync(`${path}.thumb.webp`);
    }
    path = join(dir, 'file-gif');
    const frames = Buffer.alloc(32 * 32 * 2 * 3);
    frames.fill(255, 0, 32 * 32 * 3);
    for (let pixel = 32 * 32 * 3; pixel < frames.length; pixel += 3) frames[pixel] = 255;
    writeFileSync(path, await sharp(frames, { raw: { width: 32, height: 64, pageHeight: 32, channels: 3 } })
      .gif({ delay: [120, 240], loop: 2 }).toBuffer());
    const animated = await previewImage(file('animasi.GIF'));
    assert.match(animated, /^data:image\/webp;base64,/);
    const animatedBytes = Buffer.from(animated.split(',')[1]!, 'base64');
    const animatedMetadata = await sharp(animatedBytes).metadata();
    assert.equal(animatedMetadata.pages, 2);
    assert.deepEqual(animatedMetadata.delay, [120, 240]);
    assert.equal(animatedMetadata.loop, 2);
    const firstFrame = await sharp(animatedBytes, { page: 0 }).ensureAlpha().raw().toBuffer();
    const secondFrame = await sharp(animatedBytes, { page: 1 }).ensureAlpha().raw().toBuffer();
    assert.notDeepEqual(firstFrame.subarray(0, 4), secondFrame.subarray(0, 4));
    assert.equal(secondFrame[3], 255);
    assert.equal(await previewImage(file('animasi.GIF')), animated);
    assert.ok(statSync(`${path}.thumb.webp`).size <= 2 * 1024 * 1024);
    rmSync(`${path}.thumb.webp`);
    path = join(dir, 'file-too-many-frames');
    const manyFrames = Buffer.alloc(121 * 3);
    for (let frame = 0; frame < 121; frame++) manyFrames[frame * 3] = frame % 2 ? 255 : 0;
    writeFileSync(path, await sharp(manyFrames, { raw: { width: 1, height: 121, pageHeight: 1, channels: 3 } })
      .gif({ delay: 100, keepDuplicateFrames: true }).toBuffer());
    await assert.rejects(previewImage(file('terlalu-banyak.gif')));
    path = join(dir, 'file-oversized-animation');
    writeFileSync(path, await sharp(randomBytes(320 * 320 * 48 * 3), { raw: { width: 320, height: 320 * 48, pageHeight: 320, channels: 3 } })
      .gif({ effort: 1, delay: 100 }).toBuffer());
    await assert.rejects(previewImage(file('terlalu-berat.gif')));
    assert.equal(existsSync(`${path}.thumb.webp`), false);
    assert.equal(existsSync(`${path}.thumb.webp.${process.pid}.tmp`), false);
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
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
