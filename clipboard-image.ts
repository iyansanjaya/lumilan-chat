import sharp, { type Metadata } from 'sharp';
import { errorCode } from './shared/model.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_CLIPBOARD_IMAGE = 20 * 1024 * 1024;
export async function inspectClipboardImage(value: unknown) {
  if (!(value instanceof ArrayBuffer || value instanceof Uint8Array) || !value.byteLength || value.byteLength > MAX_CLIPBOARD_IMAGE)
    throw new Error('Gambar clipboard harus berukuran 1 B–20 MB.');
  const bytes = Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  // Reject active/vector formats before selecting any image decoder.
  const raster = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
    (bytes[0]===255&&bytes[1]===216&&bytes[2]===255) ||
    ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)) ||
    (bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP');
  if (!raster) throw new Error('Gambar clipboard tidak valid atau terlalu besar (maksimal 40 juta piksel dan 120 frame).');
  const image = sharp(bytes, { animated: true, limitInputPixels: 40_000_000, failOn: 'warning' });
  let metadata: Metadata;
  try {
    metadata = await image.metadata();
    if (!['png','jpeg','webp','gif'].includes(metadata.format) || !metadata.width || !metadata.height ||
        metadata.width * metadata.height > 40_000_000 || (metadata.pages || 1) > 120) throw new Error();
    // Headers alone cannot detect corrupt/truncated compressed pixel data.
    await image.stats();
  } catch { throw new Error('Gambar clipboard tidak valid atau terlalu besar (maksimal 40 juta piksel dan 120 frame).'); }
  return { bytes, metadata };
}
export async function stageClipboardImage(value: unknown, root: string) {
  const { bytes, metadata } = await inspectClipboardImage(value);
  const directory = await mkdtemp(join(root, '.clipboard-'));
  const dispose = () => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  try {
    const path = join(directory, `Image-${Date.now()}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    return { path, dispose };
  } catch (error) {
    await dispose().catch(cleanupError => console.warn('Gagal membersihkan gambar clipboard sementara:', errorCode(cleanupError) || 'unknown'));
    throw error;
  }
}
