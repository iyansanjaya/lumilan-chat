import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', getNetwork: () => network, acceptFile: async () => true });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
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
    await assert.rejects(b.sendFile('umum.txt', Buffer.from('arsip')), /pesan pribadi/);
    await assert.rejects(a.receiveFile(b.id, { message: { ...file.message, to: null }, bytes: 'YXJzaXA=' }), /File tidak valid/);
    const id = a.id;
    await a.stop();
    assert.equal(a.snapshot().me.id, id);
    assert.equal(a.snapshot().peers.length, 0);
    await a.start();
    assert.equal(a.id, id);
    assert.equal(a.trusted.get(b.id).name, 'Budi');
    assert.equal(a.state.unread[b.id], 1);
    await until(() => a.online.has(b.id) && b.online.has(a.id));
    assert.equal(b.snapshot().announcementRoomCreated, false);
    b.createAnnouncementRoom();
    assert.equal((await b.sendAnnouncement('Pengumuman')).delivered, 1);
    assert.equal(a.snapshot().unread.announcements, 1);
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9UudwAAAAASUVORK5CYII=';
    b.setProfile({ name: 'Budi', status: 'busy', about: 'Sedang bekerja', avatar });
    await until(() => a.trusted.get(b.id)?.status === 'busy');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id).about, 'Sedang bekerja');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id).avatar, avatar);
    network = 'kantor';
    assert.equal(await a.refreshNetwork(), true);
    assert.equal(a.snapshot().messages.some(message => message.kind === 'announcement'), true);
    assert.equal(a.snapshot().unread.announcements, 1);
    const bId = b.id;
    await b.stop();
    await until(() => !a.online.has(bId));
    assert.equal(a.snapshot().peers.some(peer => peer.id === bId), false);
    assert.equal(a.snapshot().messages.some(message => message.to === bId || message.from === bId && message.kind !== 'announcement'), false);
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
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
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

test('transfer bertahap memverifikasi batas 100 MB, persetujuan, batal, dan potongan rusak', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-chunks-'));
  let accept = true;
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => accept });
  try {
    await a.start();
    await b.start();
    a.rename('Andi');
    b.rename('Budi');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    assert.equal(a.trusted.get(b.id).fileChunks, true);

    const source = join(root, 'contoh.bin');
    const contents = Buffer.alloc(1024 * 1024 + 17, 0x6b);
    writeFileSync(source, contents);
    const progress = [];
    const sent = await a.sendFilePath(source, b.id, { onProgress: bytes => progress.push(bytes) });
    assert.equal(sent.delivered, 1);
    assert.equal(progress.at(-1), contents.length);
    assert.ok(progress.length >= 3);
    assert.deepEqual(readFileSync(b.filePath(sent.message.id).path), contents);
    assert.equal(a.filePath(sent.message.id).name, 'contoh.bin');

    accept = false;
    await assert.rejects(a.sendFilePath(source, b.id), /Penerima menolak file/);
    await assert.rejects(a.sendFile('lama.bin', Buffer.from('arsip'), b.id), /Penerima menolak file/);
    assert.equal(b.state.messages.filter(message => message.kind === 'file').length, 1);
    accept = true;

    let answerOffer;
    b.acceptFile = () => new Promise(resolve => { answerOffer = resolve; });
    const pendingId = randomUUID();
    const pending = a.sendTo(b.id, { type: 'file-start', message: { id: pendingId, to: b.id, name: 'menunggu.bin', size: 4 } });
    await until(() => Boolean(answerOffer));
    await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: { id: randomUUID(), to: b.id, name: 'lain.bin', size: 4 } }), /sedang menerima file lain/);
    answerOffer(false);
    await assert.rejects(pending, /Penerima menolak file/);
    b.acceptFile = async () => accept;

    const controller = new AbortController();
    await assert.rejects(a.sendFilePath(source, b.id, {
      signal: controller.signal,
      onProgress: bytes => { if (bytes >= 512 * 1024) controller.abort(new Error('Pengiriman dibatalkan.')); },
    }), /dibatalkan/);
    assert.equal(b.incomingFiles.size, 0);

    const badId = randomUUID();
    await a.sendTo(b.id, { type: 'file-start', message: { id: badId, to: b.id, name: 'rusak.bin', size: 4 } });
    await assert.rejects(a.sendTo(b.id, { type: 'file-chunk', id: badId, offset: 1, bytes: 'YWJjZA==' }), /Potongan file tidak valid/);
    assert.equal(b.incomingFiles.size, 0);
    const wrongHashId = randomUUID();
    await a.sendTo(b.id, { type: 'file-start', message: { id: wrongHashId, to: b.id, name: 'hash-rusak.bin', size: 4 } });
    await a.sendTo(b.id, { type: 'file-chunk', id: wrongHashId, offset: 0, bytes: 'YWJjZA==' });
    await assert.rejects(a.sendTo(b.id, { type: 'file-end', id: wrongHashId, sha256: '0'.repeat(64) }), /File tidak lengkap atau rusak/);
    assert.equal(b.incomingFiles.size, 0);
    assert.equal(readdirSync(b.filesDir).filter(name => name.endsWith('.part')).length, 0);
    assert.equal(readdirSync(a.filesDir).filter(name => name.endsWith('.part')).length, 0);

    const interruptedId = randomUUID();
    await a.sendTo(b.id, { type: 'file-start', message: { id: interruptedId, to: b.id, name: 'terputus.bin', size: 4 } });
    await a.sendTo(b.id, { type: 'file-chunk', id: interruptedId, offset: 0, bytes: 'YWI=' });
    assert.equal(b.incomingFiles.size, 1);
    await b.stop();
    assert.equal(readdirSync(b.filesDir).filter(name => name.endsWith('.part')).length, 0);
    await b.start();
    await until(() => a.online.has(b.id) && b.online.has(a.id));

    const tooLarge = join(root, 'terlalu-besar.bin');
    writeFileSync(tooLarge, '');
    truncateSync(tooLarge, 100 * 1024 * 1024 + 1);
    await assert.rejects(a.sendFilePath(tooLarge, b.id), /1 B–100 MB/);

    a.rememberPeer(b.id, 'Budi', [], { fileChunks: false });
    const compatible = await a.sendFilePath(source, b.id);
    assert.deepEqual(readFileSync(b.filePath(compatible.message.id).path), contents);
    const originalProfilePacket = a.profilePacket.bind(a);
    a.profilePacket = async () => ({ ok: true, name: 'Budi', fileChunks: false });
    const legacyLarge = join(root, 'klien-lama-21MB.bin');
    writeFileSync(legacyLarge, '');
    truncateSync(legacyLarge, 21 * 1024 * 1024);
    await assert.rejects(a.sendFilePath(legacyLarge, b.id), /Perbarui Lumilan Chat/);
    a.profilePacket = originalProfilePacket;
    a.rememberPeer(b.id, 'Budi', [], { fileChunks: true });

    const limit = join(root, 'batas-100MB.bin');
    writeFileSync(limit, '');
    truncateSync(limit, 100 * 1024 * 1024);
    const exact = await a.sendFilePath(limit, b.id);
    assert.equal(statSync(b.filePath(exact.message.id).path).size, 100 * 1024 * 1024);
    const expected = createHash('sha256');
    for (let index = 0; index < 100; index++) expected.update(Buffer.alloc(1024 * 1024));
    assert.equal(exact.message.sha256, expected.digest('hex'));
    assert.equal(b.state.messages.at(-1).sha256, exact.message.sha256);
  } finally {
    await a.stop();
    await b.stop();
    rmSync(root, { recursive: true, force: true });
  }
});


test('ringkasan menghitung riwayat penuh dan daftar file memakai halaman 50 item', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-history-'));
  const peer = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const other = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await peer.start();
    await other.start();
    peer.rename('Andi');
    other.rename('Budi');
    await peer.connectAddress(other.addresses[0]);
    for (let index = 0; index < 1060; index++) peer.state.messages.push({
      id: `${index.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`, from: peer.id, fromName: 'Andi', to: other.id,
      kind: index % 10 === 0 ? 'file' : 'text', name: `file-${index}.txt`, size: 1,
      text: 'Halo', at: Date.now(),
    });
    const snapshot = peer.snapshot();
    assert.equal(snapshot.stats[other.id].messages, 1060);
    assert.equal(snapshot.stats[other.id].files, 106);
    assert.equal(snapshot.messages.length, 1000);
    const older = peer.listMessages(other.id, snapshot.messages[0].id);
    assert.equal(older.length, 60);
    assert.equal(older[0].id, peer.state.messages[0].id);
    assert.equal(peer.listMessages(other.id, older[0].id).length, 0);
    assert.equal(snapshot.recentFiles[other.id].length, 5);
    assert.equal(peer.listFiles(other.id, 0).items.length, 50);
    assert.equal(peer.listFiles(other.id, 50).items.length, 50);
    assert.equal(peer.listFiles(other.id, 100).items.length, 6);
    assert.equal(peer.listFiles(other.id, 0).total, 106);
  } finally {
    await peer.stop();
    await other.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Ruang berundangan, Pengumuman, koneksi manual, dan peer offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-rooms-'));
  const peers = ['Andi', 'Budi', 'Citra'].map((name, index) => new LumilanPeer({
    dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
  }));
  const [a, b, c] = peers;
  try {
    for (const [index, peer] of peers.entries()) { await peer.start(); peer.rename(['Andi', 'Budi', 'Citra'][index]); }
    await a.connectAddress(b.addresses[0]);
    await a.connectAddress(c.addresses[0]);
    await b.connectAddress(c.addresses[0]);
    assert.equal(a.online.has(b.id) && b.online.has(c.id), true);
    await assert.rejects(a.connectAddress(`/ip4/8.8.8.8/tcp/40754/p2p/${b.id}`), /Kode perangkat tidak valid/);

    const { id } = await a.createRoom('Proyek', [b.id, c.id]);
    assert.equal(b.room(id).pending, true);
    assert.equal(c.room(id).pending, true);
    await b.acceptRoom(id);
    assert.equal((await a.sendRoomMessage('Hanya Budi', id)).delivered, 1);
    assert.equal(c.state.messages.some(message => message.roomId === id), false);
    await c.acceptRoom(id);
    await until(() => b.room(id).members.includes(c.id));
    assert.equal((await b.sendRoomMessage('Semua anggota', id)).delivered, 2);
    assert.equal(c.listMessages(`room:${id}`).at(-1).text, 'Semua anggota');

    await a.updateRoom(id, [c.id]);
    assert.equal(b.room(id), undefined);
    await assert.rejects(b.sendRoomMessage('Ditolak', id), /Pesan Ruang tidak valid/);
    await assert.rejects(b.sendTo(c.id, { type: 'room-message', message: {
      id: randomUUID(), roomId: id, to: null, kind: 'text', text: 'Ditolak',
    } }), /Pesan Ruang ditolak/);

    assert.equal(a.snapshot().announcementRoomCreated, false);
    await assert.rejects(a.sendAnnouncement('Rapat pagi'), /Buat Ruang Pengumuman/);
    a.createAnnouncementRoom();
    assert.equal(a.snapshot().announcementRoomCreated, true);
    assert.throws(() => a.createAnnouncementRoom(), /sudah dibuat/);
    assert.equal((await a.sendAnnouncement('Rapat pagi')).delivered, 2);
    assert.equal(b.snapshot().announcementRoomCreated, false);
    await assert.rejects(b.sendAnnouncement('Tanpa Ruang'), /Buat Ruang Pengumuman/);
    c.setAnnouncements(false);
    await until(() => a.trusted.get(c.id)?.announcements === false);
    assert.equal((await a.sendAnnouncement('Rapat siang')).delivered, 1);
    assert.equal(c.state.messages.filter(message => message.kind === 'announcement').length, 1);
    b.muteAnnouncementsFrom(a.id, true);
    assert.deepEqual((await a.sendAnnouncement('Rapat sore')).delivered, 0);
    assert.equal(b.state.messages.filter(message => message.kind === 'announcement').length, 2);
    b.muteAnnouncementsFrom(a.id, false);
    for (let index = 0; index < 8; index++) assert.equal((await a.sendAnnouncement(`Info ${index}`)).delivered, 1);
    assert.deepEqual((await a.sendAnnouncement('Terlalu sering')).delivered, 0);
    assert.equal(b.state.messages.filter(message => message.kind === 'announcement').length, 10);
    await assert.rejects(a.sendTo(b.id, { type: 'message', message: {
      id: randomUUID(), to: null, kind: 'text', text: 'Ruang Umum lama',
    } }), /Pesan tidak valid/);
    const declined = await a.createRoom('Undangan', [b.id]);
    await b.declineRoom(declined.id);
    await until(() => !a.room(declined.id).invited.includes(b.id));
    assert.equal(b.room(declined.id), undefined);
    const canceled = await a.createRoom('Dibatalkan', [b.id]);
    await a.updateRoom(canceled.id, []);
    assert.equal(b.room(canceled.id), undefined);

    await c.stop();
    await until(() => !a.online.has(c.id));
    await assert.rejects(a.sendRoomMessage('Tidak diantrekan', id), /Tidak ada anggota Ruang yang online/);
    assert.equal(a.state.messages.some(message => message.text === 'Tidak diantrekan'), false);
    await a.deleteRoom(id);
    await c.start();
    await until(() => c.room(id) === undefined);
    const later = await a.createRoom('Keluar', [b.id]);
    await b.acceptRoom(later.id);
    await a.stop();
    await b.leaveRoom(later.id);
    assert.equal(b.room(later.id), undefined);
    await a.start();
    assert.equal(a.snapshot().announcementRoomCreated, true);
    await until(() => !a.room(later.id).members.includes(b.id));
  } finally {
    for (const peer of peers) await peer.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
