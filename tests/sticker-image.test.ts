import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { STICKER_MAX_BYTES, StickerImageError, encodeSticker, sniffImage, stickerThumbnail } from '../src/main/sticker-image.js';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
// Every frame a different grey, so encoders cannot fold neighbours into one.
function frames(width: number, pageHeight: number, pages: number) {
  const pixels = Buffer.alloc(width * pageHeight * pages * 3);
  for (let page = 0; page < pages; page++) pixels.fill(page * 37 % 256, page * width * pageHeight * 3, (page + 1) * width * pageHeight * 3);
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

const refused = (reason: string) => (error: unknown) => error instanceof StickerImageError && error.reason === reason;

test('impor stiker menyebut alasan setiap gambar yang ditolak', async () => {
  for (const image of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), await solid(8, 8).tiff().toBuffer(), Buffer.concat([Buffer.from('BM'), Buffer.alloc(64)])])
    await assert.rejects(encodeSticker(image, 'import'), refused('format'));
  const png = await solid(64, 64).png().toBuffer();
  await assert.rejects(encodeSticker(Buffer.concat([png, Buffer.alloc(20 * 1024 * 1024)]), 'import'), refused('too-big'));
  await assert.rejects(encodeSticker(png.subarray(0, png.length - 40), 'import'), refused('damaged'));
  // A header claiming 20 000 × 20 000 px is refused as too large from the header alone, before any pixel is decoded.
  const huge = Buffer.from(png);
  huge.writeUInt32BE(20_000, 16);
  huge.writeUInt32BE(20_000, 20);
  huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
  await assert.rejects(encodeSticker(huge, 'import'), refused('pixels'));
});

test('animasi lebih dari 120 frame dipangkas tanpa mengubah durasinya', async () => {
  const sticker = await encodeSticker(await frames(16, 16, 200).gif({ delay: Array(200).fill(40), keepDuplicateFrames: true }).toBuffer(), 'import');
  const metadata = await sharp(sticker.bytes, { animated: true }).metadata();
  assert.deepEqual([sticker.width, sticker.height, sticker.animated], [16, 16, true]);
  assert.deepEqual([metadata.pages, metadata.pageHeight], [100, 16], 'every second frame is kept');
  assert.equal(metadata.delay!.reduce((sum, ms) => sum + ms, 0), 200 * 40, 'each kept frame lasts as long as the frames it replaces');
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
