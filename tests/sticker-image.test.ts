import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { STICKER_MAX_BYTES, encodeSticker, sniffImage, stickerThumbnail } from '../src/main/sticker-image.js';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
// Two differently coloured frames, so encoders cannot fold them into one.
function frames(width: number, pageHeight: number, pages: number) {
  const pixels = Buffer.alloc(width * pageHeight * pages * 3);
  for (let page = 0; page < pages; page++) pixels.fill(page % 2 ? 255 : 30, page * width * pageHeight * 3, (page + 1) * width * pageHeight * 3);
  return sharp(pixels, { raw: { width, height: pageHeight * pages, pageHeight, channels: 3 } });
}

test('impor stiker menormalkan PNG, JPEG, WebP, dan GIF menjadi WebP maksimal 512 px', async () => {
  for (const image of [await solid(800, 600).png().toBuffer(), await solid(800, 600).jpeg().toBuffer(), await solid(800, 600).webp().toBuffer()]) {
    const sticker = await encodeSticker(image, 'import');
    assert.equal(sniffImage(sticker.bytes), 'webp');
    assert.deepEqual([sticker.width, sticker.height, sticker.animated], [512, 384, false]);
    assert(sticker.bytes.length <= 200 * 1024);
  }
  const small = await encodeSticker(await solid(64, 32).png().toBuffer(), 'import');
  assert.deepEqual([small.width, small.height], [64, 32], 'small images are not enlarged');

  const gif = await frames(600, 300, 2).gif({ delay: [120, 240], loop: 0 }).toBuffer();
  const animated = await encodeSticker(gif, 'import');
  assert.deepEqual([animated.width, animated.height, animated.animated], [512, 256, true], 'the height is per frame');
  assert.equal((await sharp(animated.bytes, { animated: true }).metadata()).pages, 2);
  assert(animated.bytes.length <= STICKER_MAX_BYTES);
});

test('impor stiker menolak format lain, terlalu banyak frame, dan data rusak', async () => {
  await assert.rejects(encodeSticker(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'import'), /tidak didukung/);
  await assert.rejects(encodeSticker(await solid(8, 8).tiff().toBuffer(), 'import'), /tidak didukung/);
  await assert.rejects(encodeSticker(Buffer.concat([Buffer.from('BM'), Buffer.alloc(64)]), 'import'), /tidak didukung/);
  await assert.rejects(encodeSticker(await frames(2, 2, 121).gif({ delay: 100, keepDuplicateFrames: true }).toBuffer(), 'import'), /120 frame/);
  const png = await solid(64, 64).png().toBuffer();
  await assert.rejects(encodeSticker(png.subarray(0, png.length - 40), 'import'), /tidak didukung/);
});

test('stiker dari peer hanya menerima WebP kecil dan di-encode ulang', async () => {
  const wire = (await encodeSticker(await solid(300, 200).png().toBuffer(), 'import')).bytes;
  const received = await encodeSticker(wire, 'wire');
  assert.deepEqual([received.width, received.height, received.animated], [300, 200, false]);
  assert.equal(sniffImage(received.bytes), 'webp');
  await assert.rejects(encodeSticker(await solid(64, 64).png().toBuffer(), 'wire'), /Stiker tidak valid/, 'PNG is never accepted from a peer');
  await assert.rejects(encodeSticker(await solid(600, 100).webp().toBuffer(), 'wire'), /Stiker tidak valid/, 'a peer never sends more than 512 px');
  await assert.rejects(encodeSticker(Buffer.concat([wire, Buffer.alloc(STICKER_MAX_BYTES)]), 'wire'), /Stiker tidak valid/);
  const animated = (await encodeSticker(await frames(120, 120, 3).gif({ delay: 100 }).toBuffer(), 'import')).bytes;
  assert.equal((await encodeSticker(animated, 'wire')).animated, true);
});

test('thumbnail pemilih diam, kecil, dan antrean penerima menolak saat penuh', async () => {
  const animated = (await encodeSticker(await frames(400, 400, 2).gif({ delay: 100 }).toBuffer(), 'import')).bytes;
  const thumb = await stickerThumbnail(animated);
  const metadata = await sharp(thumb, { animated: true }).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.pages ?? 1, 1, 'the picker shows a still first frame');
  assert(metadata.width! <= 128 && metadata.height! <= 128 && thumb.length <= 24 * 1024);

  const wire = (await encodeSticker(await solid(512, 512).png().toBuffer(), 'import')).bytes;
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => encodeSticker(wire, 'wire')));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 4);
  for (const result of results.slice(4)) assert(result.status === 'rejected' && /sibuk/.test(String(result.reason)));
  await encodeSticker(wire, 'wire');
});
