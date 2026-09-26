import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { LanDiscovery, lanInterfaces } from './discovery.js';
import { LumilanPeer } from './peer.js';

async function until(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Perangkat tidak kembali terhubung.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test('mDNS mengirim pada setiap antarmuka LAN, bukan adaptor VPN saja', async () => {
  const interfaces = lanInterfaces({
    Tailscale: [{ family: 'IPv4', address: '100.91.124.75', internal: false }],
    VirtualBox: [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    WiFi: [{ family: 'IPv4', address: '192.168.1.9', internal: false }],
  });
  assert.deepEqual(interfaces, ['192.168.56.1', '192.168.1.9']);
  const id = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
  const sockets = [];
  const discovery = new LanDiscovery({ addressManager: { getAddresses: () => [
    multiaddr(`/ip4/192.168.56.1/tcp/1234/p2p/${id}`),
    multiaddr(`/ip4/192.168.1.9/tcp/1234/p2p/${id}`),
    multiaddr(`/ip4/100.91.124.75/tcp/1234/p2p/${id}`),
  ] } }, () => interfaces, options => {
    const socket = Object.assign(new EventEmitter(), {
      interface: options.interface, bind: options.bind, queries: [], responses: [],
      query(packet) { this.queries.push(packet); },
      respond(packet) { this.responses.push(packet); },
      destroy(callback) { callback(); },
    });
    sockets.push(socket);
    return socket;
  });
  try {
    discovery.start();
    assert.deepEqual(sockets.map(socket => socket.interface), interfaces);
    assert.ok(sockets.every(socket => socket.bind === '0.0.0.0'));
    for (const socket of sockets) socket.emit('ready');
    assert.ok(sockets.every(socket => socket.queries.length === 1));
    sockets[1].emit('query', { questions: [{ name: '_p2p._udp.local', type: 'PTR' }] });
    assert.equal(sockets[1].responses[0].filter(answer => answer.type === 'TXT').length, 1);
    assert.match(sockets[1].responses[0][1].data, /\/ip4\/192\.168\.1\.9\/tcp\//);
    const response = sockets[1].responses[0];
    let discovered;
    discovery.addEventListener('peer', event => { discovered = event.detail; });
    discovery.receive({ answers: response.map(answer => ({
      ...answer, name: answer.type === 'TXT' ? 'remote._p2p._udp.local' : answer.name,
      data: answer.type === 'TXT' ? [Buffer.from(answer.data)] : 'remote._p2p._udp.local',
    })) });
    assert.equal(discovered.id.toString(), id);
    assert.equal(discovered.multiaddrs.length, 1);
  } finally { await discovery.stop(); }
});

test('perangkat LAN dapat langsung berkirim pesan dan file setelah ditemukan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-peer-'));
  let network = 'rumah';
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', getNetwork: () => network });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const c = new LumilanPeer({ dataDir: join(root, 'c'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start();
    await b.start();
    await c.start();
    a.rename('Andi');
    b.rename('Budi');
    assert.equal(a.snapshot().peers.length, 0);
    let refused = false;
    await a.handleProfile({ abort: () => { refused = true; } }, { remotePeer: b.node.peerId, remoteAddr: multiaddr('/ip4/8.8.8.8/tcp/1234') });
    assert.equal(refused, true);
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
    assert.equal(a.state.unread[b.id], 1);
    assert.equal(a.file(file.message.id).name, 'pesan.txt');
    assert.equal(a.file(file.message.id).bytes.toString(), 'arsip');
    const id = a.id;
    await a.stop();
    assert.equal(a.snapshot().me.id, id);
    assert.equal(a.snapshot().peers.length, 0);
    await a.start();
    assert.equal(a.id, id);
    assert.equal(a.trusted.get(b.id).name, 'Budi');
    assert.equal(a.state.unread[b.id], 1);
    await until(() => a.online.has(b.id) && b.online.has(a.id));
    assert.equal((await b.sendMessage('Ruang umum')).delivered, 1);
    assert.equal(a.snapshot().unread.room, 1);
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9UudwAAAAASUVORK5CYII=';
    b.setProfile({ name: 'Budi', status: 'busy', about: 'Sedang bekerja', avatar });
    await until(() => a.trusted.get(b.id)?.status === 'busy');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id).about, 'Sedang bekerja');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id).avatar, avatar);
    const oldRoomSession = a.roomSession;
    network = 'kantor';
    assert.equal(await a.refreshNetwork(), true);
    assert.notEqual(a.roomSession, oldRoomSession);
    assert.equal(a.snapshot().messages.some(message => message.to === null), false);
    assert.equal(a.snapshot().unread.room, undefined);
    const bId = b.id;
    await b.stop();
    await until(() => !a.online.has(bId));
    assert.equal(a.snapshot().peers.some(peer => peer.id === bId), false);
    assert.equal(a.snapshot().messages.some(message => message.to === bId || message.from === bId), false);
    assert.equal(a.snapshot().unread[bId], undefined);
  } finally {
    await a.stop();
    await b.stop();
    await c.stop();
    rmSync(root, { recursive: true, force: true });
  }
});


test('isi pesan tidak tampak pada lalu lintas TCP antara dua peer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-noise-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const captured = [];
  let proxy;
  try {
    await a.start();
    await b.start();
    a.rename('Andi');
    b.rename('Budi');
    const port = Number(b.addresses[0].match(/\/tcp\/(\d+)/)[1]);
    proxy = createServer(client => {
      const upstream = connect(port, '127.0.0.1');
      client.on('data', chunk => { captured.push(Buffer.from(chunk)); upstream.write(chunk); });
      upstream.on('data', chunk => { captured.push(Buffer.from(chunk)); client.write(chunk); });
      client.on('error', () => {});
      upstream.on('error', () => {});
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const address = `/ip4/127.0.0.1/tcp/${proxy.address().port}/p2p/${b.id}`;
    const wrongId = b.id.slice(0, -1) + (b.id.endsWith('1') ? '2' : '1');
    await assert.rejects(a.node.dial(multiaddr(`/ip4/127.0.0.1/tcp/${proxy.address().port}/p2p/${wrongId}`), {
      signal: AbortSignal.timeout(3000),
    }));
    a.discovered.set(b.id, [address]);
    await a.probePeer(b.id);
    const secret = `pesan-rahasia-${Date.now()}-untuk-budi`;
    await a.sendMessage(secret, b.id);
    assert.equal(b.snapshot().messages.at(-1).text, secret);
    assert.ok(captured.length > 0);
    assert.equal(Buffer.concat(captured).includes(Buffer.from(secret)), false);
    const fileSecret = Buffer.from(`berkas-rahasia-${Date.now()}-untuk-budi`);
    const sent = await a.sendFile('privat.txt', fileSecret, b.id);
    assert.deepEqual(b.file(sent.message.id).bytes, fileSecret);
    assert.equal(Buffer.concat(captured).includes(Buffer.from(fileSecret.toString('base64'))), false);
  } finally {
    await a.stop();
    await b.stop();
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});


test('ringkasan menghitung riwayat penuh dan daftar file memakai halaman 50 item', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-history-'));
  const peer = new LumilanPeer({ dataDir: root, discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await peer.start();
    peer.rename('Andi');
    for (let index = 0; index < 1060; index++) peer.state.messages.push({
      id: `${index.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`, from: peer.id, fromName: 'Andi', to: null,
      kind: index % 10 === 0 ? 'file' : 'text', name: `file-${index}.txt`, size: 1,
      text: 'Halo', roomSession: peer.roomSession, at: Date.now(),
    });
    const snapshot = peer.snapshot();
    assert.equal(snapshot.stats.room.messages, 1060);
    assert.equal(snapshot.stats.room.files, 106);
    assert.equal(snapshot.messages.length, 1000);
    const older = peer.listMessages(null, snapshot.messages[0].id);
    assert.equal(older.length, 60);
    assert.equal(older[0].id, peer.state.messages[0].id);
    assert.equal(peer.listMessages(null, older[0].id).length, 0);
    assert.equal(snapshot.recentFiles.room.length, 5);
    assert.equal(peer.listFiles(null, 0).items.length, 50);
    assert.equal(peer.listFiles(null, 50).items.length, 50);
    assert.equal(peer.listFiles(null, 100).items.length, 6);
    assert.equal(peer.listFiles(null, 0).total, 106);
  } finally {
    await peer.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
