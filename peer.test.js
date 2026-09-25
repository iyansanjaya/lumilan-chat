import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LumilanPeer } from './peer.js';

async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Perangkat tidak kembali terhubung.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test('perangkat LAN dapat langsung berkirim pesan dan file setelah ditemukan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-peer-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const c = new LumilanPeer({ dataDir: join(root, 'c'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start();
    await b.start();
    await c.start();
    a.rename('Andi');
    b.rename('Budi');
    assert.equal(a.snapshot().peers.length, 0);
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    assert.equal(a.snapshot().peers[0].name, 'Budi');
    assert.equal(b.snapshot().peers[0].name, 'Andi');
    assert.equal(a.online.has(b.id), true);
    assert.equal(b.online.has(a.id), true);

    c.discovered.set(a.id, a.addresses);
    c.rename('Citra');
    await until(() => c.trusted.has(a.id) && a.trusted.has(c.id));
    assert.equal(c.snapshot().peers[0].name, 'Andi');
    assert.equal(a.snapshot().peers.find(peer => peer.id === c.id).name, 'Citra');

    const incomingB = [];
    const incomingA = [];
    b.on('incoming', message => incomingB.push(message));
    a.on('incoming', message => incomingA.push(message));
    const result = await a.sendMessage('Halo, Budi', b.id);
    assert.equal(result.delivered, 1);
    assert.equal(b.snapshot().messages[0].text, 'Halo, Budi');
    assert.equal(incomingB.length, 1);
    assert.equal(b.snapshot().unread[a.id], 1);
    b.receiveMessage(a.id, result.message);
    assert.equal(incomingB.length, 1);
    b.markRead(a.id);
    assert.equal(b.snapshot().unread[a.id], undefined);
    const file = await b.sendFile('../pesan.txt', Buffer.from('arsip'), a.id);
    assert.equal(file.delivered, 1);
    assert.equal(incomingA.length, 1);
    assert.equal(a.snapshot().unread[b.id], 1);
    assert.equal(a.file(file.message.id).name, 'pesan.txt');
    assert.equal(a.file(file.message.id).bytes.toString(), 'arsip');
    const id = a.id;
    await a.stop();
    await a.start();
    assert.equal(a.id, id);
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id).name, 'Budi');
    assert.equal(a.snapshot().unread[b.id], 1);
    await until(() => a.online.has(b.id) && b.online.has(a.id));
    assert.equal((await b.sendMessage('Ruang umum')).delivered, 1);
    assert.equal(a.snapshot().unread.room, 1);
  } finally {
    await a.stop();
    await b.stop();
    await c.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
