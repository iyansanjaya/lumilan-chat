import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

sharp.cache({ files: 0 });

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const MAX_GIF_FRAMES = 120;
const MAX_GIF_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const jobs = new Map();
let generating = Promise.resolve();

export async function previewImage(file) {
  const extension = /\.(png|jpe?g|webp|gif)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension) throw new Error('Pratinjau gambar tidak tersedia.');
  const original = await stat(file.path);
  if (!original.isFile() || original.size > MAX_FILE_BYTES) throw new Error('Pratinjau gambar tidak tersedia.');
  const animated = extension === 'gif';
  const maxThumbnailBytes = animated ? MAX_GIF_THUMBNAIL_BYTES : MAX_THUMBNAIL_BYTES;
  const thumbnail = `${file.path}.thumb.webp`;
  let job = jobs.get(thumbnail);
  if (!job) {
    job = (async () => {
      try {
        const cached = await stat(thumbnail);
        if (cached.size > 0 && cached.size <= maxThumbnailBytes && cached.mtimeMs >= original.mtimeMs) return;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      // ponytail: one decode at a time bounds memory; queue can be widened if thumbnail latency becomes visible.
      const create = generating.then(async () => {
        const metadata = await sharp(file.path, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
        const expected = extension === 'jpg' ? 'jpeg' : extension === 'jpeg' ? 'jpeg' : extension;
        const frames = metadata.pages || 1;
        const frameHeight = metadata.pageHeight || metadata.height;
        if (metadata.format !== expected || !metadata.width || !frameHeight ||
            metadata.width * frameHeight * frames > MAX_PIXELS || frames > (animated ? MAX_GIF_FRAMES : 1))
          throw new Error('Pratinjau gambar tidak tersedia.');
        const temporary = `${thumbnail}.${process.pid}.tmp`;
        try {
          if (animated) {
            await sharp(file.path, { animated: true, limitInputPixels: MAX_PIXELS, failOn: 'error' })
              .resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 65 }).toFile(temporary);
          } else {
            const bytes = await sharp(file.path, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
              .autoOrient().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
            await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
          }
          const generated = await stat(temporary);
          if (!generated.size || generated.size > maxThumbnailBytes) throw new Error('Pratinjau gambar tidak tersedia.');
          await rename(temporary, thumbnail);
        } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      });
      generating = create.catch(() => {});
      await create;
    })().finally(() => jobs.delete(thumbnail));
    jobs.set(thumbnail, job);
  }
  await job;
  const bytes = await readFile(thumbnail);
  if (!bytes.length || bytes.length > maxThumbnailBytes) throw new Error('Pratinjau gambar tidak tersedia.');
  return `data:image/webp;base64,${bytes.toString('base64')}`;
}
