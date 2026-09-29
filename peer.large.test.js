import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LumilanPeer } from './peer.js';

test('file tepat 2 GB berhasil dikirim dan diverifikasi', { skip: process.env.LUMILAN_TEST_2GB !== '1' }, async () => {
  const root = mkdtempSync(join(process.cwd(), '.lumilan-large-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  try {
    await a.start();
    await b.start();
    a.rename('Pengirim');
    b.rename('Penerima');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    const source = join(root, 'batas-2GB.bin');
    writeFileSync(source, '');
    truncateSync(source, 2 * 1024 ** 3);
    let progress = 0;
    const result = await a.sendFilePath(source, b.id, { onProgress: sent => { progress = sent; } });
    assert.equal(result.delivered, 1);
    assert.equal(progress, 2 * 1024 ** 3);
    assert.equal(statSync(b.filePath(result.message.id).path).size, 2 * 1024 ** 3);
    assert.equal(b.state.messages.at(-1).sha256, result.message.sha256);
  } finally {
    await a.stop();
    await b.stop();
    assert.ok(root.startsWith(join(process.cwd(), '.lumilan-large-')));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
