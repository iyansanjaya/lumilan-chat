import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, createReadStream, existsSync, mkdtempSync, openSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LumilanPeer } from '../src/main/peer.js';

async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

test('file tepat 5 GB berhasil dikirim dan diverifikasi', { skip: process.env.LUMILAN_TEST_5GB !== '1' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-large-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  try {
    await a.start();
    await b.start();
    a.rename('Pengirim');
    b.rename('Penerima');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    const source = join(root, 'batas-5GB.bin');
    writeFileSync(source, '');
    truncateSync(source, 5 * 1024 ** 3);
    // Distinct bytes around chunk and integer-size boundaries catch misplaced chunks too.
    const handle = openSync(source, 'r+');
    try {
      for (const offset of [0, 512 * 1024 - 1, 2 * 1024 ** 3 - 1, 4 * 1024 ** 3 - 1, 5 * 1024 ** 3 - 1]) {
        const marker = Buffer.from(`boundary:${offset}`);
        const position = Math.min(offset, 5 * 1024 ** 3 - marker.length);
        assert.equal(writeSync(handle, marker, 0, marker.length, position), marker.length);
      }
    } finally { closeSync(handle); }
    let progress = 0;
    let reported = -1;
    const result = await a.sendFilePath(source, b.id, { onProgress: sent => {
      progress = sent;
      const percent = Math.floor(sent / (5 * 1024 ** 3) * 10) * 10;
      if (percent > reported) { reported = percent; console.log(`5 GB transfer: ${percent}%`); }
    } });
    assert.equal(result.delivered, 1);
    assert.equal(progress, 5 * 1024 ** 3);
    assert.equal(statSync(b.filePath(result.message.id).path).size, 5 * 1024 ** 3);
    assert.equal(b.state.messages.at(-1)!.sha256, result.message.sha256);
    const expected = await fileHash(source);
    assert.equal(await fileHash(b.filePath(result.message.id).path), expected, 'Receiver bytes differ from source');
    assert.equal(result.message.sha256, expected);
    const count = b.state.messages.length;
    const local = await a.sendFilePath(source, 'notes');
    assert.equal(local.message.note, true);
    assert.equal(statSync(a.filePath(local.message.id).path).size, 5 * 1024 ** 3);
    assert.equal(await fileHash(a.filePath(local.message.id).path), expected, 'Local note attachment differs from source');
    assert.equal(b.state.messages.length, count, 'Personal attachment reached the network');
    const localPath = a.filePath(local.message.id).path;
    await a.deleteMessages('notes', [local.message.id]);
    assert.equal(a.state.messages.some(message => message.id === local.message.id), false);
    assert.equal(existsSync(localPath), false, 'Deleted personal attachment remains on disk');
  } finally {
    await a.stop();
    await b.stop();
    assert.ok(root.startsWith(join(tmpdir(), 'lumilan-large-')));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
