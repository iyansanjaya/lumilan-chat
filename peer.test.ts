import type { FileOffer, FileTransfer, Message, SendResult, PeerResponse } from './shared/model.js';
import { errorCode, errorMessage, record, readPeerState } from './shared/model.js';
import type { AddressInfo, Server } from 'node:net';
import type { PeerInfo } from '@libp2p/interface';
import type { Packet, Answer } from 'dns-packet';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import { multiaddr } from '@multiformats/multiaddr';
import { LanDiscovery, lanInterfaces } from './discovery.js';
import { LumilanPeer } from './peer.js';
import { stageClipboardImage } from './clipboard-image.js';
import sharp from 'sharp';

async function until(predicate: () => unknown, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Perangkat tidak kembali terhubung.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

test('startup recovery removes only owned clipboard stages and never follows directory links', async t => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-clipboard-recovery-'));
  let next: LumilanPeer | undefined;
  t.after(async () => {
    await next?.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const options = { dataDir: join(root, 'profile'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' };
  const previous = new LumilanPeer(options);
  mkdirSync(previous.filesDir, { recursive: true, mode: 0o700 });
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffd36d' } }).png().toBuffer();
  const staged = await stageClipboardImage(png, previous.filesDir);
  assert.deepEqual(readFileSync(staged.path), png);
  const unrelated = ['.clipboard-', '.clipboard-ABCDE', '.clipboard-ABCDEFG', '.clipboard-ABC_12', 'lumilan-clipboard-ABC123'];
  for (const name of unrelated) {
    mkdirSync(join(previous.filesDir, name));
    writeFileSync(join(previous.filesDir, name, 'keep.txt'), 'unrelated');
  }
  writeFileSync(join(previous.filesDir, '.clipboard-FILE12'), 'regular file is not a stage');
  const external = join(root, 'outside');
  mkdirSync(external);
  writeFileSync(join(external, 'keep.txt'), 'outside private file root');
  const link = join(previous.filesDir, '.clipboard-LINK12');
  try {
    symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(external, join(dirname(staged.path), 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOSYS'].includes(String(errorCode(error)))) throw error;
    t.diagnostic(`Directory link unavailable: ${errorCode(error)}`);
  }
  next = new LumilanPeer(options);
  await next.start();
  assert(!existsSync(staged.path), 'Previous process clipboard stage survived recovery');
  assert(!existsSync(link), 'Recovery left an owned directory link');
  assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'outside private file root');
  assert.equal(readFileSync(join(next.filesDir, '.clipboard-FILE12'), 'utf8'), 'regular file is not a stage');
  for (const name of unrelated) assert.equal(readFileSync(join(next.filesDir, name, 'keep.txt'), 'utf8'), 'unrelated');
  const liveStage = await stageClipboardImage(png, next.filesDir);
  await next.stop();
  await next.start();
  assert.deepEqual(readFileSync(liveStage.path), png, 'Network rebind removed a live clipboard stage');
  await next.stop();
  next = new LumilanPeer(options);
  await next.start();
  assert(!existsSync(liveStage.path), 'A fresh peer instance failed to recover an orphan stage');
});

test('persetujuan file yang gagal disiapkan mengakhiri kartu transfer penerima', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-consent-failure-'));
  const receiver = new LumilanPeer({ dataDir: root, discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  try {
    await receiver.start();
    const sender = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
    receiver.state.trusted.push({ id: sender, name: 'Pengirim' });
    const events: FileTransfer[] = [];
    receiver.on('file-transfer', event => events.push(event));
    const id = randomUUID();
    const collision = join(receiver.filesDir, `.upload-${id}.part`);
    writeFileSync(collision, 'existing file must stay intact');
    await assert.rejects(receiver.beginIncomingFile(sender, { id, to: receiver.id, name: 'Test.bin', size: 1 }), { code: 'EEXIST' });
    assert.deepEqual(events, [{ id, status: 'canceled' }], 'The receiver UI was left waiting after accepted file setup failed');
    assert.equal(receiver.pendingFileOffers.size, 0);
    assert.equal(receiver.incomingFiles.size, 0);
    assert.equal(readFileSync(collision, 'utf8'), 'existing file must stay intact');

    events.length = 0;
    let resolveConsent!: (accepted: boolean) => void;
    receiver.acceptFile = () => new Promise(resolve => { resolveConsent = resolve; });
    const canceledId = randomUUID();
    const receiving = receiver.beginIncomingFile(sender, { id: canceledId, to: receiver.id, name: 'Canceled.bin', size: 1 });
    await receiver.cancelIncomingFile(canceledId, sender);
    resolveConsent(true);
    await assert.rejects(receiving, /Pengiriman dibatalkan/);
    assert.deepEqual(events, [{ id: canceledId, status: 'canceled' }], 'Cancellation must end the card once, even when acceptance arrives later');
    assert.equal(receiver.pendingFileOffers.size, 0);
    assert.equal(receiver.incomingFiles.size, 0);
    assert(!existsSync(join(receiver.filesDir, `.upload-${canceledId}.part`)));
  } finally {
    await receiver.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('mDNS mengirim pada setiap antarmuka LAN, bukan adaptor VPN saja', async () => {
  const interfaces = lanInterfaces({
    Tailscale: [{ family: 'IPv4', address: '100.91.124.75', internal: false }],
    VirtualBox: [{ family: 'IPv4', address: '192.168.56.1', internal: false }],
    WiFi: [{ family: 'IPv4', address: '192.168.1.9', internal: false }],
  });
  assert.deepEqual(interfaces, ['192.168.56.1', '192.168.1.9']);
  const id = peerIdFromPrivateKey(await generateKeyPair('Ed25519')).toString();
  const sockets: (EventEmitter & { interface: string | undefined; bind: string | false | undefined; queries: unknown[]; responses: Answer[][]; query(packet: unknown): void; respond(packet: unknown): void; destroy(callback?: () => void): void })[] = [];
  const discovery = new LanDiscovery({ addressManager: { getAddresses: () => [
    multiaddr(`/ip4/192.168.56.1/tcp/1234/p2p/${id}`),
    multiaddr(`/ip4/192.168.1.9/tcp/1234/p2p/${id}`),
    multiaddr(`/ip4/100.91.124.75/tcp/1234/p2p/${id}`),
  ] } }, () => interfaces, options => {
    const socket = Object.assign(new EventEmitter(), {
      interface: options.interface, bind: options.bind, queries: [] as unknown[], responses: [] as Answer[][],
      query(packet: unknown) { this.queries.push(packet); },
      respond(packet: unknown) { assert(Array.isArray(packet)); this.responses.push(packet as Answer[]); },
      destroy(callback?: () => void) { callback?.(); },
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
    sockets[1]!.emit('query', { questions: [{ name: '_p2p._udp.local', type: 'PTR' }] });
    assert.equal(sockets[1]!.responses[0]!.filter(answer => answer.type === 'TXT').length, 1);
    const txt = sockets[1]!.responses[0]![1]!; assert(txt.type === 'TXT' && 'data' in txt && typeof txt.data === 'string');
    assert.match(txt.data, /\/ip4\/192\.168\.1\.9\/tcp\//);
    const response = sockets[1]!.responses[0]!;
    let discovered: PeerInfo | undefined;
    discovery.addEventListener('peer', event => { discovered = event.detail; });
    discovery.receive({ answers: response.map((answer): Answer => {
      assert('data' in answer && typeof answer.data === 'string');
      return answer.type === 'TXT' ? {type:'TXT', name:'remote._p2p._udp.local', data:[Buffer.from(answer.data)]} : {type:'PTR', name:answer.name, data:'remote._p2p._udp.local'};
    }) });
    assert.equal(discovered!.id.toString(), id);
    assert.equal(discovered!.multiaddrs.length, 1);
  } finally { await discovery.stop(); }
});

test('tanda pribadi tetap lokal dan bertahan saat kontak mengganti nama', async () => {
  const root = mkdtempSync(join(process.cwd(), '.lumilan-label-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start(); await b.start();
    a.rename('Saya'); b.rename('Puan');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    a.setContactLabel(b.id, 'Puan lama');
    assert.equal(a.snapshot().contactLabels[b.id], 'Puan lama');
    assert.equal(b.snapshot().contactLabels[a.id], undefined);
    b.rename('Banteng');
    await until(() => a.snapshot().peers.some(peer => peer.id === b.id && peer.name === 'Banteng'));
    assert.equal(a.snapshot().contactLabels[b.id], 'Puan lama');
    await a.stop(); await a.start();
    assert.equal(a.snapshot().contactLabels[b.id], 'Puan lama');
    assert.throws(() => a.setContactLabel('invalid', 'X'), /tidak valid/);
    a.setContactLabel(b.id, '');
    assert.equal(a.snapshot().contactLabels[b.id], undefined);
  } finally {
    await a.stop(); await b.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
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
    await a.handleProfile({ abort: () => { refused = true; }, inactivityTimeout: 0, maxReadBufferLength: 0, async *[Symbol.asyncIterator]() {}, send: () => true, async onDrain() {}, async close() {} }, { remotePeer: b.node!.peerId, remoteAddr: multiaddr('/ip4/8.8.8.8/tcp/1234') });
    assert.equal(refused, true);
    assert.equal(a.snapshot().peers.length, 0);
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    assert.equal(a.snapshot().peers[0]!.name, 'Budi');
    assert.equal(b.snapshot().peers[0]!.name, 'Andi');
    assert.equal(a.online.has(b.id), true);
    assert.equal(b.online.has(a.id), true);
    await a.sendTyping(b.id, true);
    assert.deepEqual(b.snapshot().typing, [{ from: a.id, thread: a.id }]);
    assert.equal(b.state.messages.length, 0);
    await a.sendTyping(b.id, false);
    assert.deepEqual(b.snapshot().typing, []);

    c.discovered.set(a.id, a.addresses);
    c.rename('Citra');
    await until(() => c.trusted.has(a.id) && a.trusted.has(c.id));
    assert.equal(c.snapshot().peers[0]!.name, 'Andi');
    assert.equal(a.snapshot().peers.find(peer => peer.id === c.id)!.name, 'Citra');

    const incomingB = [];
    const incomingA = [];
    b.on('incoming', message => incomingB.push(message));
    a.on('incoming', message => incomingA.push(message));
    const result = await a.sendMessage('Halo, Budi', b.id);
    assert.equal(result.delivered, 1);
    assert.equal(b.snapshot().messages[0]!.text, 'Halo, Budi');
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
    assert.equal(a.trusted.get(b.id)!.name, 'Budi');
    assert.equal(a.state.unread[b.id], 1);
    await until(() => a.online.has(b.id) && b.online.has(a.id));
    assert.equal(b.snapshot().announcementRoomCreated, false);
    b.createAnnouncementRoom();
    assert.equal((await b.sendAnnouncement('Pengumuman')).delivered, 1);
    assert.equal(a.snapshot().unread.announcements, 1);
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9UudwAAAAASUVORK5CYII=';
    b.setProfile({ name: 'Budi', status: 'busy', about: 'Sedang bekerja', avatar });
    await until(() => a.trusted.get(b.id)?.status === 'busy');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id)!.about, 'Sedang bekerja');
    assert.equal(a.snapshot().peers.find(peer => peer.id === b.id)!.avatar, avatar);
    network = 'kantor';
    assert.equal(await a.refreshNetwork(), true);
    assert.equal(a.snapshot().messages.some(message => message.kind === 'announcement'), true);
    assert.equal(a.snapshot().unread.announcements, 1);
    const bId = b.id;
    await b.stop();
    await until(() => !a.online.has(bId));
    assert.equal(a.snapshot().peers.some(peer => peer.id === bId), false);
    assert.equal(a.snapshot().contacts.find(peer => peer.id === bId)!.avatar, avatar);
    assert.equal(a.snapshot().messages.some(message => message.to === bId || message.from === bId && message.kind !== 'announcement'), false);
    assert.equal(a.snapshot().unread[bId], undefined);
  } finally {
    await a.stop();
    await b.stop();
    await c.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});


test('isi pesan tidak tampak pada lalu lintas TCP antara dua peer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-noise-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  const captured: Buffer[] = [];
  let proxy: Server | undefined;
  try {
    await a.start();
    await b.start();
    a.rename('Andi');
    b.rename('Budi');
    const port = Number(b.addresses[0]!.match(/\/tcp\/(\d+)/)![1]!);
    proxy = createServer(client => {
      const upstream = connect(port, '127.0.0.1');
      client.on('data', chunk => { captured.push(Buffer.from(chunk)); upstream.write(chunk); });
      upstream.on('data', chunk => { captured.push(Buffer.from(chunk)); client.write(chunk); });
      client.on('error', () => {});
      upstream.on('error', () => {});
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>(resolve => proxy!.listen(0, '127.0.0.1', resolve));
    const address = `/ip4/127.0.0.1/tcp/${(proxy!.address() as AddressInfo).port}/p2p/${b.id}`;
    const wrongId = b.id.slice(0, -1) + (b.id.endsWith('1') ? '2' : '1');
    await assert.rejects(a.node!.dial(multiaddr(`/ip4/127.0.0.1/tcp/${(proxy!.address() as AddressInfo).port}/p2p/${wrongId}`), {
      signal: AbortSignal.timeout(3000),
    }));
    a.discovered.set(b.id, [address]);
    await a.probePeer(b.id);
    const secret = `pesan-rahasia-${Date.now()}-untuk-budi`;
    await a.sendMessage(secret, b.id);
    assert.equal(b.snapshot().messages.at(-1)!.text, secret);
    assert.ok(captured.length > 0);
    assert.equal(Buffer.concat(captured).includes(Buffer.from(secret)), false);
    const fileSecret = Buffer.from(`berkas-rahasia-${Date.now()}-untuk-budi`);
    const sent = await a.sendFile('privat.txt', fileSecret, b.id);
    assert.deepEqual(b.file(sent.message.id).bytes, fileSecret);
    assert.equal(Buffer.concat(captured).includes(Buffer.from(fileSecret.toString('base64'))), false);
  } finally {
    await a.stop();
    await b.stop();
    if (proxy) await new Promise<void>(resolve => proxy!.close(() => resolve()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('persetujuan file pribadi tidak menahan pesan atau file berikutnya', async t => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-private-independent-'));
  const decisions = new Map<string, FileOffer & PromiseWithResolvers<boolean>>();
  const operations: Promise<unknown>[] = [];
  const controllers: AbortController[] = [];
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
    acceptFile: offer => {
      const decision = Promise.withResolvers<boolean>();
      decisions.set(offer.id, { ...offer, ...decision });
      return decision.promise;
    },
  });
  b.on('file-transfer', transfer => {
    if (transfer.status === 'canceled') decisions.get(transfer.id)?.resolve(false);
  });
  try {
    await a.start();
    await b.start();
    a.rename('Pengirim Uji');
    b.rename('Penerima Uji');
    await a.connectAddress(b.addresses[0]);
    for (const scenario of ['accept', 'decline', 'cancel']) {
      await t.test(scenario, async () => {
        const previousOffers = decisions.size;
        const contents = [Buffer.alloc(512 * 1024 + 17, 0x41), Buffer.alloc(512 * 1024 + 31, 0x42)];
        const sources = contents.map((bytes, index) => {
          const path = join(root, `${scenario}-${index}.png`);
          writeFileSync(path, bytes);
          return path;
        });
        const controller = new AbortController();
        controllers.push(controller);
        const first = a.sendFilePath(sources[0]!, b.id, { signal: controller.signal });
        first.catch(() => {});
        operations.push(first);
        await until(() => decisions.size === previousOffers + 1);
        const firstOffer = [...decisions.values()].at(-1)!;
        const second = a.sendFilePath(sources[1]!, b.id);
        second.catch(() => {});
        operations.push(second);
        await Promise.race([until(() => decisions.size === previousOffers + 2), second]);
        const secondOffer = [...decisions.values()].at(-1)!;
        const text = await a.sendMessage(`Pesan saat dua file menunggu: ${scenario}`, b.id);
        assert.equal(b.state.messages.at(-1)!.id, text.message.id);
        assert.equal(b.pendingFileOffers.size, 2);
        assert.equal(b.incomingFiles.size, 0);
        assert(!b.state.messages.some(message => message.id === firstOffer.id || message.id === secondOffer.id));

        secondOffer.resolve(true);
        const sent = await second;
        assert.equal(sent.message.id, secondOffer.id);
        assert.equal(sent.message.sha256, createHash('sha256').update(contents[1]!).digest('hex'));
        assert.deepEqual(readFileSync(b.filePath(secondOffer.id).path), contents[1]!);
        assert(b.pendingFileOffers.has(firstOffer.id), 'File kedua menunggu persetujuan file pertama');
        assert(!b.state.messages.some(message => message.id === firstOffer.id));
        if (scenario === 'cancel') controller.abort(new Error('Pengiriman dibatalkan.'));
        else firstOffer.resolve(scenario === 'accept');
        if (scenario === 'accept') {
          const accepted = await first;
          assert.equal(accepted.message.sha256, createHash('sha256').update(contents[0]!).digest('hex'));
          assert.deepEqual(readFileSync(b.filePath(firstOffer.id).path), contents[0]!);
        } else {
          await assert.rejects(first, scenario === 'cancel' ? /dibatalkan/ : /Penerima menolak file/);
          assert(!b.state.messages.some(message => message.id === firstOffer.id));
          assert(!existsSync(join(a.filesDir, firstOffer.id)));
        }
        await until(() => b.pendingFileOffers.size === 0 && b.incomingFiles.size === 0);
        assert.deepEqual(readFileSync(b.filePath(secondOffer.id).path), contents[1]!, 'Keputusan file pertama merusak file kedua');
        for (const peer of [a, b]) assert.equal(readdirSync(peer.filesDir).filter(name => name.endsWith('.part')).length, 0);
      });
    }
    await t.test('batas bersama, ID duplikat, dan reservasi disk', async () => {
      const previousOffers = decisions.size;
      const ids = Array.from({ length: 7 }, () => randomUUID());
      const pending: Promise<unknown>[] = ids.map(id => a.sendTo(b.id, { type: 'file-start', message: { id, to: b.id, name: 'bornes.bin', size: 4 } }));
      const legacyBytes = Buffer.from('legacy held for consent');
      const legacyController = new AbortController();
      controllers.push(legacyController);
      pending.push(a.sendFile('legacy-held.bin', legacyBytes, b.id, { signal: legacyController.signal }));
      for (const operation of pending) { operation.catch(() => {}); operations.push(operation); }
      await until(() => decisions.size === previousOffers + 8);
      assert.equal(b.pendingFileOffers.size, 8);
      assert.equal(b.incomingFileReservation(), 7 * 4 + legacyBytes.length);
      const text = await a.sendMessage('Pesan saat delapan file menunggu persetujuan', b.id);
      assert.equal(b.state.messages.at(-1)!.id, text.message.id);
      await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: { id: ids[0]!, to: b.id, name: 'replay.bin', size: 4 } }), /ID file sudah digunakan/);
      await assert.rejects(a.sendTo(b.id, { type: 'file', message: {
        id: ids[0]!, to: b.id, name: 'replay-legacy.bin', size: legacyBytes.length,
        sha256: createHash('sha256').update(legacyBytes).digest('hex'),
      }, bytes: legacyBytes.toString('base64') }), /ID file sudah digunakan/);
      await assert.rejects(a.sendFile('overflow-legacy.bin', legacyBytes, b.id), /sedang menerima file lain/);
      decisions.get(ids[0]!)!.resolve(true);
      await pending[0];
      assert.equal(b.incomingFiles.size, 1);
      assert.equal(b.pendingFileOffers.size, 7);
      await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: { id: randomUUID(), to: b.id, name: 'overflow.bin', size: 4 } }), /sedang menerima file lain/);
      await a.sendTo(b.id, { type: 'file-chunk', id: ids[0]!, offset: 0, bytes: Buffer.from('ab').toString('base64') });
      assert.equal(b.incomingFileReservation(), 7 * 4 + legacyBytes.length - 2);
      await a.sendTo(b.id, { type: 'file-cancel', id: ids[0]! });
      assert.equal(b.incomingFileReservation(), 6 * 4 + legacyBytes.length);
      const legacyOffer = [...decisions.values()].find(offer => offer.name === 'legacy-held.bin')!;
      legacyController.abort(new Error('Pengiriman dibatalkan.'));
      for (const id of ids.slice(1)) decisions.get(id)!.resolve(false);
      const results = await Promise.allSettled(pending);
      assert.equal(results[0]!.status, 'fulfilled');
      assert(results.slice(1).every(result => result.status === 'rejected'));
      const last = results.at(-1)!; assert(last.status === 'rejected');
      assert.match(errorMessage(last.reason), /Pengiriman dibatalkan/);
      assert.equal(b.pendingFileOffers.size, 0);
      assert.equal(b.incomingFiles.size, 0);
      assert.equal(b.incomingFileReservation(), 0);
      legacyOffer.resolve(true);
      assert(!b.state.messages.some(message => message.id === legacyOffer.id));
      assert(!existsSync(join(b.filesDir, legacyOffer.id)));
      for (const peer of [a, b]) assert.equal(readdirSync(peer.filesDir).filter(name => name.endsWith('.part')).length, 0);
    });
  } finally {
    for (const decision of decisions.values()) decision.resolve(false);
    for (const controller of controllers) controller.abort(new Error('Pengujian selesai.'));
    await Promise.allSettled(operations);
    await Promise.all([a.stop(), b.stop()]);
    assert.ok(root.startsWith(join(tmpdir(), 'lumilan-private-independent-')));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('transfer bertahap memverifikasi batas 5 GB, kompatibilitas, persetujuan, batal, dan potongan rusak', async () => {
  const root = mkdtempSync(join(process.cwd(), '.lumilan-chunks-'));
  let accept = true;
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => accept });
  const transferEvents: FileTransfer[] = [];
  b.on('file-transfer', event => transferEvents.push(event));
  try {
    await a.start();
    await b.start();
    a.rename('Andi');
    b.rename('Budi');
    a.discovered.set(b.id, b.addresses);
    await a.probePeer(b.id);
    assert.equal(a.trusted.get(b.id)!.fileChunks, true);
    assert.equal(a.trusted.get(b.id)!.maxFileSize, 5 * 1024 * 1024 * 1024);

    const source = join(root, 'contoh.bin');
    const contents = Buffer.alloc(1024 * 1024 + 17, 0x6b);
    writeFileSync(source, contents);
    const progress: number[] = [];
    const statuses: string[] = [];
    const sent = await a.sendFilePath(source, b.id, { onProgress: bytes => progress.push(bytes), onStatus: status => statuses.push(status) });
    assert.equal(sent.delivered, 1);
    assert.deepEqual(statuses, ['preparing', 'waiting']);
    assert.equal(progress.at(-1), contents.length);
    assert.ok(progress.length >= 3);
    assert.ok(transferEvents.some(event => event.status === 'receiving' && event.received! > 0));
    assert.equal(transferEvents.at(-1)!.status, 'complete');
    assert.deepEqual(readFileSync(b.filePath(sent.message.id).path), contents);
    assert.equal(a.filePath(sent.message.id).name, 'contoh.bin');

    accept = false;
    await assert.rejects(a.sendFilePath(source, b.id), /Penerima menolak file/);
    await assert.rejects(a.sendFile('lama.bin', Buffer.from('arsip'), b.id), /Penerima menolak file/);
    assert.equal(b.state.messages.filter(message => message.kind === 'file').length, 1);
    accept = true;

    let answerOffer!: (accepted: boolean) => void;
    b.acceptFile = () => new Promise(resolve => { answerOffer = resolve; });
    const pendingId = randomUUID();
    const pending = a.sendTo(b.id, { type: 'file-start', message: { id: pendingId, to: b.id, name: 'menunggu.bin', size: 4 } });
    await until(() => Boolean(answerOffer));
    await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: { id: pendingId, to: b.id, name: 'lain.bin', size: 4 } }), /ID file sudah digunakan/);
    answerOffer(false);
    await assert.rejects(pending, /Penerima menolak file/);
    b.acceptFile = async () => accept;

    const preparingController = new AbortController();
    await assert.rejects(a.sendFilePath(source, b.id, {
      signal: preparingController.signal,
      onPreparationProgress: bytes => { if (bytes >= 512 * 1024) preparingController.abort(new Error('Pengiriman dibatalkan.')); },
    }), /dibatalkan/);
    assert.equal(readdirSync(a.filesDir).filter(name => name.endsWith('.part')).length, 0);
    const changingSource = join(root, 'berubah.bin');
    writeFileSync(changingSource, contents);
    await assert.rejects(a.sendFilePath(changingSource, b.id, {
      onPreparationProgress: bytes => { if (bytes === 512 * 1024) writeFileSync(changingSource, 'x', { flag: 'a' }); },
    }), /File berubah saat disiapkan/);
    assert.equal(readdirSync(a.filesDir).filter(name => name.endsWith('.part')).length, 0);

    const controller = new AbortController();
    await assert.rejects(a.sendFilePath(source, b.id, {
      signal: controller.signal,
      onProgress: bytes => { if (bytes >= 512 * 1024) controller.abort(new Error('Pengiriman dibatalkan.')); },
    }), /dibatalkan/);
    assert.equal(b.incomingFiles.size, 0);
    assert.equal(transferEvents.at(-1)!.status, 'canceled');

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

    accept = false;
    await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: {
      id: randomUUID(), to: b.id, name: 'batas-5GB.bin', size: 5 * 1024 * 1024 * 1024,
    } }), /Penerima menolak file|Ruang penyimpanan tidak cukup/);
    accept = true;
    await assert.rejects(a.sendTo(b.id, { type: 'file-start', message: {
      id: randomUUID(), to: b.id, name: 'terlalu-besar.bin', size: 5 * 1024 * 1024 * 1024 + 1,
    } }), /melebihi 5 GB/);

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
    a.rememberPeer(b.id, 'Budi', [], { fileChunks: true, roomFiles: true });
    assert.equal(a.trusted.get(b.id)!.maxFileSize, 100 * 1024 * 1024);
    delete a.state.trusted.find(peer => peer.id === b.id)!.maxFileSize;
    a.profilePacket = async () => ({ ok: true, name: 'Budi', fileChunks: true, roomFiles: true });
    truncateSync(legacyLarge, 100 * 1024 * 1024 + 1);
    await assert.rejects(a.sendFilePath(legacyLarge, b.id), /di atas 100 MB/);
    a.profilePacket = originalProfilePacket;
    truncateSync(legacyLarge, 2 * 1024 ** 3 + 1);
    for (const limit of [500 * 1024 ** 2, 2 * 1024 ** 3]) {
      a.rememberPeer(b.id, 'Budi', [], { fileChunks: true, roomFiles: true, maxFileSize: limit });
      a.profilePacket = async () => ({ ok: true, name: 'Budi', fileChunks: true, roomFiles: true, maxFileSize: limit });
      await assert.rejects(a.sendFilePath(legacyLarge, b.id), /Perbarui Lumilan Chat/);
    }
    a.profilePacket = originalProfilePacket;
    a.rememberPeer(b.id, 'Budi', [], b.profile());

    const limit = join(root, 'batas-500MB.bin');
    writeFileSync(limit, '');
    truncateSync(limit, 500 * 1024 * 1024);
    const exact = await a.sendFilePath(limit, b.id);
    assert.equal(statSync(b.filePath(exact.message.id).path).size, 500 * 1024 * 1024);
    const expected = createHash('sha256');
    const zeros = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < 500; index++) expected.update(zeros);
    assert.equal(exact.message.sha256, expected.digest('hex'));
    assert.equal(b.state.messages.at(-1)!.sha256, exact.message.sha256);
  } finally {
    await a.stop();
    await b.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});


test('file Ruang dikirim hanya ke anggota aktif dengan persetujuan dan dibersihkan bersama riwayat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-room-file-'));
  let acceptB = true;
  const peers = ['Andi', 'Budi', 'Citra'].map((name, index) => new LumilanPeer({
    dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
    acceptFile: async () => index === 1 ? acceptB : true,
  }));
  const a = peers[0]!, b = peers[1]!, c = peers[2]!;
  try {
    for (const [index, peer] of peers.entries()) { await peer.start(); peer.rename(['Andi', 'Budi', 'Citra'][index]); }
    await a.connectAddress(b.addresses[0]);
    await a.connectAddress(c.addresses[0]);
    const { id } = await a.createRoom('Berkas Proyek', [b.id, c.id]);
    await b.acceptRoom(id);
    await c.acceptRoom(id);
    await until(() => b.room(id)?.members.length === 3 && c.room(id)?.members.length === 3);
    const source = join(root, 'laporan.gif');
    const contents = Buffer.alloc(512 * 1024 + 17, 0x67);
    writeFileSync(source, contents);
    const progress: [number,number][] = [];
    const sent = await a.sendFilePath(source, `room:${id}`, { onProgress: (done, total) => progress.push([done, total]) });
    assert.equal(sent.delivered, 2);
    assert.equal(sent.failed, 0);
    assert.deepEqual(progress.at(-1), [contents.length * 2, contents.length * 2]);
    assert.equal(a.state.messages.filter(message => message.id === sent.message.id).length, 1);
    for (const peer of [b, c]) {
      assert.deepEqual(readFileSync(peer.filePath(sent.message.id).path), contents);
      assert.equal(peer.listFiles(`room:${id}`).total, 1);
      assert.equal(peer.snapshot().unread[`room:${id}`], 1);
    }
    assert.deepEqual(a.listFiles(`room:${id}`).items.map(file => file.id), [sent.message.id]);

    acceptB = false;
    const partial = await a.sendFilePath(source, `room:${id}`);
    assert.equal(partial.delivered, 1);
    assert.equal(partial.failed, 1);
    assert.equal(b.state.messages.some(message => message.id === partial.message.id), false);
    assert.equal(c.state.messages.some(message => message.id === partial.message.id), true);
    acceptB = true;
    a.state.trusted.find(peer => peer.id === c.id)!.roomFiles = false;
    const incompatible = await a.sendFilePath(source, `room:${id}`);
    assert.equal(incompatible.delivered, 1);
    assert.equal(incompatible.failed, 1);
    assert.equal(c.state.messages.some(message => message.id === incompatible.message.id), false);
    a.state.trusted.find(peer => peer.id === c.id)!.roomFiles = true;
    a.state.trusted.find(peer => peer.id === c.id)!.maxFileSize = 512 * 1024;
    const olderRoomPeer = await a.sendFilePath(source, `room:${id}`);
    assert.equal(olderRoomPeer.delivered, 1);
    assert.equal(olderRoomPeer.failed, 1);
    assert.equal(c.state.messages.some(message => message.id === olderRoomPeer.message.id), false);
    a.state.trusted.find(peer => peer.id === c.id)!.maxFileSize = 500 * 1024 * 1024;
    a.state.trusted.find(peer => peer.id === b.id)!.roomFiles = false;
    a.state.trusted.find(peer => peer.id === c.id)!.roomFiles = false;
    await assert.rejects(a.sendFilePath(source, `room:${id}`), /Tidak ada anggota Ruang online yang mendukung ukuran file/);
    assert.equal(readdirSync(a.filesDir).filter(name => name.endsWith('.part')).length, 0);
    a.state.trusted.find(peer => peer.id === b.id)!.roomFiles = true;
    a.state.trusted.find(peer => peer.id === c.id)!.roomFiles = true;

    const controller = new AbortController();
    const sendTo = a.sendTo.bind(a);
    a.sendTo = async (target, packet, options) => {
      if (target === c.id && packet.type === 'file-start') {
        await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
        throw controller.signal.reason;
      }
      const result = await sendTo(target, packet, options);
      if (target === b.id && packet.type === 'file-end') controller.abort(new Error('Pengiriman dibatalkan.'));
      return result;
    };
    const stopped = await a.sendFilePath(source, `room:${id}`, { signal: controller.signal });
    a.sendTo = sendTo;
    assert.equal(stopped.delivered, 1);
    assert.equal(stopped.failed, 1);
    assert.equal(stopped.canceled, true);
    assert.equal(b.state.messages.some(message => message.id === stopped.message.id), true);
    assert.equal(c.state.messages.some(message => message.id === stopped.message.id), false);

    a.archiveThread(`room:${id}`);
    await assert.rejects(a.sendFilePath(source, `room:${id}`), /Pulihkan percakapan/);
    a.restoreThread(`room:${id}`);
    await assert.rejects(a.sendFilePath(source, 'announcements'), /Penerima atau Ruang tidak valid/);
    await a.updateRoom(id, [b.id]);
    await assert.rejects(c.sendTo(a.id, { type: 'file-start', message: {
      id: randomUUID(), roomId: id, version: c.room(id)?.version || 1, to: null, name: 'ilegal.gif', size: 4,
    } }), /File tidak valid/);
    await a.deleteRoom(id);
    await until(() => !b.room(id));
    assert.equal(b.listFiles(`room:${id}`).total, 4);
    await b.deleteArchivedHistory(`room:${id}`);
    assert.equal(existsSync(join(b.filesDir, sent.message.id)), false);
  } finally {
    await Promise.all(peers.map(peer => peer.stop()));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('persetujuan dan transfer file Ruang independen untuk setiap penerima', async t => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-room-independent-'));
  let decision: PromiseWithResolvers<boolean> | null = null;
  let offeredId: string | null = null;
  const peers = ['Andi', 'Budi', 'Citra'].map((name, index) => new LumilanPeer({
    dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
    acceptFile: async offer => {
      offeredId = offer.id;
      return index === 1 && decision ? decision.promise : true;
    },
  }));
  const a = peers[0]!, b = peers[1]!, c = peers[2]!;
  // Mirror the app's cancellation of an unanswered consent dialog.
  b.on('file-transfer', transfer => { if (transfer.status === 'canceled') (decision as PromiseWithResolvers<boolean> | null)?.resolve(false); });
  const sendTo = a.sendTo.bind(a);
  let operation: Promise<SendResult> | undefined;
  let chunkGate: PromiseWithResolvers<void> | null = null;
  let controller: AbortController | undefined;
  try {
    for (const [index, peer] of peers.entries()) { await peer.start(); peer.rename(['Andi', 'Budi', 'Citra'][index]); }
    await a.connectAddress(b.addresses[0]);
    await a.connectAddress(c.addresses[0]);
    const { id } = await a.createRoom('Transfer Independen', [b.id, c.id]);
    await b.acceptRoom(id);
    await c.acceptRoom(id);
    await until(() => b.room(id)?.members.length === 3 && c.room(id)?.members.length === 3);
    const contents = Buffer.alloc(1024 * 1024 + 17, 0x49);
    const source = join(root, 'independen.bin');
    writeFileSync(source, contents);
    for (const scenario of ['accept', 'decline', 'slow', 'corrupt', 'cancel']) {
      await t.test(scenario, async () => {
        offeredId = null;
        decision = ['accept', 'decline', 'cancel'].includes(scenario) ? Promise.withResolvers<boolean>() : null;
        chunkGate = scenario === 'slow' ? Promise.withResolvers<void>() : null;
        let chunkPaused = false;
        controller = new AbortController();
        const progress: [number, number][] = [];
        const statuses: string[] = [];
        a.sendTo = async (target, packet, options) => {
          if (target === b.id && packet.type === 'file-chunk' && chunkGate) {
            chunkPaused = true;
            await chunkGate.promise;
          }
          if (target === b.id && packet.type === 'file-end' && scenario === 'corrupt')
            packet = { ...packet, sha256: '0'.repeat(64) };
          return sendTo(target, packet, options);
        };
        operation = a.sendFilePath(source, `room:${id}`, {
          signal: controller.signal, onStatus: status => statuses.push(status),
          onProgress: (done, total) => progress.push([done, total]),
        });
        operation.catch(() => {});
        await until(() => offeredId && c.state.messages.some(message => message.id === offeredId));
        assert.deepEqual(readFileSync(c.filePath(offeredId!).path), contents);
        if (decision) {
          await until(() => statuses.at(-1) === 'waiting' && progress.length > 0);
          assert.equal(b.pendingFileOffers.has(offeredId!), true);
          assert.equal(b.state.messages.some(message => message.id === offeredId), false);
          if (scenario === 'cancel') controller.abort(new Error('Pengiriman dibatalkan.'));
          else decision.resolve(scenario === 'accept');
        }
        if (chunkGate) {
          assert.equal(chunkPaused, true);
          assert.equal(b.incomingFiles.has(offeredId!), true);
          assert.equal(b.state.messages.some(message => message.id === offeredId), false);
          chunkGate.resolve();
        }
        const result = await operation;
        const accepted = ['accept', 'slow'].includes(scenario);
        assert.equal(result.delivered, accepted ? 2 : 1);
        assert.equal(result.failed, accepted ? 0 : 1);
        assert.equal(result.canceled, scenario === 'cancel');
        assert.equal(b.state.messages.some(message => message.id === result.message.id), accepted);
        if (accepted) assert.deepEqual(readFileSync(b.filePath(result.message.id).path), contents);
        assert.equal(a.state.messages.filter(message => message.id === result.message.id).length, 1);
        assert.equal(c.state.messages.at(-1)!.sha256, result.message.sha256);
        assert.deepEqual(progress.at(-1), [contents.length * 2, contents.length * 2]);
        for (let index = 1; index < progress.length; index++) assert.ok(progress[index]![0] >= progress[index - 1]![0]);
        await until(() => peers.every(peer => peer.pendingFileOffers.size === 0 && peer.incomingFiles.size === 0));
        for (const peer of peers) assert.equal(readdirSync(peer.filesDir).filter(name => name.endsWith('.part')).length, 0);
      });
    }
  } finally {
    (decision as PromiseWithResolvers<boolean> | null)?.resolve(false);
    (chunkGate as PromiseWithResolvers<void> | null)?.resolve();
    controller?.abort(new Error('Pengujian selesai.'));
    await operation?.catch(() => {});
    a.sendTo = sendTo;
    await Promise.all(peers.map(peer => peer.stop()));
    assert.ok(root.startsWith(join(tmpdir(), 'lumilan-room-independent-')));
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
    assert.equal(snapshot.stats[other.id]!.messages, 1060);
    assert.equal(snapshot.stats[other.id]!.files, 106);
    assert.equal(snapshot.messages.length, 1000);
    const older = peer.listMessages(other.id, snapshot.messages[0]!.id);
    assert.equal(older.length, 60);
    assert.equal(older[0]!.id, peer.state.messages[0]!.id);
    assert.equal(peer.listMessages(other.id, older[0]!.id).length, 0);
    assert.equal(snapshot.recentFiles[other.id]!.length, 5);
    assert.equal(peer.listFiles(other.id, 0).items.length, 50);
    assert.equal(peer.listFiles(other.id, 50).items.length, 50);
    assert.equal(peer.listFiles(other.id, 100).items.length, 6);
    assert.equal(peer.listFiles(other.id, 0).total, 106);
  } finally {
    await peer.stop();
    await other.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('arsip menyimpan percakapan offline dan penghapusan permanen membersihkan file lokal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-archive-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start();
    await b.start();
    a.rename('Andi');
    b.rename('Budi');
    await a.connectAddress(b.addresses[0]);
    await b.sendMessage('Simpan dahulu', a.id);
    const firstFile = await b.sendFile('hapus.txt', Buffer.from('hapus sekarang'), a.id);
    assert.equal(await a.deleteArchivedHistory(b.id), 2);
    assert.equal(a.listMessages(b.id).length, 0);
    assert.equal(existsSync(join(a.filesDir, firstFile.message.id)), false);
    await b.sendMessage('Simpan kembali', a.id);
    const file = await b.sendFile('dokumen.txt', Buffer.from('isi dokumen'), a.id);
    await assert.rejects(a.deleteArchivedHistory('unknown'), /Percakapan tidak tersedia/);
    a.archiveThread(b.id);
    assert.equal(a.snapshot().archivedThreads[0]!.id, b.id);
    await assert.rejects(a.sendMessage('Tidak boleh dikirim', b.id), /Pulihkan percakapan/);
    await assert.rejects(a.sendFile('tidak.txt', Buffer.from('isi'), b.id), /Pulihkan percakapan/);
    await b.stop();
    await a.stop();
    await a.start();
    assert.equal(a.snapshot().messages.length, 2);
    assert.equal(a.listMessages(b.id).length, 2);
    assert.equal(a.listFiles(b.id).total, 1);
    assert.equal(existsSync(a.filePath(file.message.id).path), true);
    writeFileSync(`${a.filePath(file.message.id).path}.thumb.webp`, 'thumbnail');
    assert.equal(await a.deleteArchivedHistory(b.id), 2);
    assert.equal(a.snapshot().stats[b.id], undefined);
    assert.equal(a.listFiles(b.id).total, 0);
    assert.equal(existsSync(join(a.filesDir, file.message.id)), false);
    assert.equal(existsSync(join(a.filesDir, `${file.message.id}.thumb.webp`)), false);
    assert.deepEqual(a.state.pendingFileDeletes, []);
    a.restoreThread(b.id);
    assert.equal(a.snapshot().archivedThreads.length, 0);
    await a.stop();
    const legacy = record(JSON.parse(readFileSync(a.path, 'utf8')));
    delete legacy.archivedThreads;
    delete legacy.pendingFileDeletes;
    writeFileSync(a.path, JSON.stringify(legacy));
    await a.start();
    assert.deepEqual(a.snapshot().archivedThreads, []);
  } finally {
    await a.stop();
    await b.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('catatan pribadi tetap ada, balasan tersinkron, dan penghapusan pesan hanya lokal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-message-actions-'));
  const a = new LumilanPeer({ dataDir: join(root, 'a'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0', acceptFile: async () => true });
  const b = new LumilanPeer({ dataDir: join(root, 'b'), discovery: false, listen: '/ip4/127.0.0.1/tcp/0' });
  try {
    await a.start(); await b.start();
    a.rename('Andi'); b.rename('Budi');
    const note = a.saveNote('Ingat rapat').message;
    const noteReply = a.saveNote('Pukul sembilan', note.id).message;
    assert.equal(noteReply.replyTo, note.id);
    assert.equal(a.snapshot().stats.notes!.messages, 2);
    assert.equal(a.listMessages('notes').length, 2);
    assert.equal(b.snapshot().stats.notes, undefined);
    const noteSource = join(root, 'lampiran-catatan.txt');
    writeFileSync(noteSource, 'Hanya untuk saya');
    const attachment = (await a.sendFilePath(noteSource, 'notes')).message;
    assert.equal(attachment.note, true);
    assert.equal(a.snapshot().stats.notes!.files, 1);
    assert.equal(a.listFiles('notes').items[0]!.id, attachment.id);
    assert.equal(readFileSync(a.filePath(attachment.id).path, 'utf8'), 'Hanya untuk saya');
    assert.equal(b.snapshot().stats.notes, undefined);
    const canceledSource = join(root, 'batal.bin');
    writeFileSync(canceledSource, '');
    truncateSync(canceledSource, 2 * 1024 * 1024);
    const controller = new AbortController();
    await assert.rejects(a.sendFilePath(canceledSource, 'notes', { signal: controller.signal,
      onProgress: sent => { if (sent >= 512 * 1024) controller.abort(new Error('Penyimpanan dibatalkan.')); },
    }), /dibatalkan/);
    assert.equal(a.snapshot().stats.notes!.files, 1);
    assert.equal(readdirSync(a.filesDir).some(name => name.endsWith('.part')), false);
    const changedSource = join(root, 'berubah.bin');
    writeFileSync(changedSource, '');
    truncateSync(changedSource, 1024 * 1024);
    await assert.rejects(a.sendFilePath(changedSource, 'notes', {
      onProgress: sent => { if (sent === 512 * 1024) writeFileSync(changedSource, 'x', { flag: 'a' }); },
    }), /File berubah/);
    assert.equal(a.snapshot().stats.notes!.files, 1);
    assert.equal(readdirSync(a.filesDir).some(name => name.endsWith('.part')), false);
    await a.connectAddress(b.addresses[0]);
    const first = (await b.sendMessage('Halo', a.id)).message;
    const reply = (await a.sendMessage('Ya', b.id, first.id)).message;
    assert.equal(b.listMessages(a.id).at(-1)!.replyTo, first.id);
    await a.react('notes', note.id, '👍');
    assert.equal(a.listMessages('notes')[0]!.reactions![a.id], '👍');
    assert.equal(b.state.messages.some(message => message.id === note.id), false);
    await a.react(b.id, first.id, '❤️');
    assert.equal(b.listMessages(a.id)[0]!.reactions![a.id], '❤️');
    await a.react(b.id, first.id, '❤️');
    assert.equal(b.listMessages(a.id)[0]!.reactions, undefined);
    await assert.rejects(a.react(b.id, first.id, 'invalid'), /Reaksi tidak valid/);
    assert.throws(() => b.receiveReaction(a.id, { id: note.id, emoji: '👍' }), /tidak ditemukan/);
    await assert.rejects(a.sendMessage('Salah', b.id, note.id), /tidak ditemukan/);
    const { id } = await a.createRoom('Diskusi', [b.id]);
    await b.acceptRoom(id);
    const roomFirst = (await b.sendRoomMessage('Topik', id)).message;
    await a.sendRoomMessage('Jawaban', id, roomFirst.id);
    assert.equal(b.listMessages(`room:${id}`).at(-1)!.replyTo, roomFirst.id);
    await a.react(`room:${id}`, roomFirst.id, '😂');
    assert.equal(b.listMessages(`room:${id}`)[0]!.reactions![a.id], '😂');
    assert.throws(() => b.receiveReaction(a.id, { id: roomFirst.id, emoji: '👍', roomId: id, version: -1 }), /ditolak/);
    await assert.rejects(a.deleteMessages('notes', [first.id]), /tidak ditemukan/);
    assert.equal(await a.deleteMessages(b.id, [first.id, reply.id]), 2);
    assert.equal(a.listMessages(b.id).length, 0);
    assert.equal(b.listMessages(a.id).length, 2);
    const file = await b.sendFile('catatan.txt', Buffer.from('lampiran'), a.id);
    assert.equal(existsSync(join(a.filesDir, file.message.id)), true);
    assert.equal(await a.deleteMessages(b.id, [file.message.id]), 1);
    assert.equal(existsSync(join(a.filesDir, file.message.id)), false);
    assert.equal(existsSync(join(b.filesDir, file.message.id)), true);
    assert.equal(await a.deleteMessages('notes', [note.id]), 1);
    assert.equal(a.snapshot().stats.notes!.messages, 2);
    await a.stop(); await a.start();
    assert.equal(a.listMessages('notes')[0]!.replyTo, note.id);
    assert.equal(a.listMessages(`room:${id}`).find(message => message.id === roomFirst.id)!.reactions![a.id], '😂');
    assert.equal(a.listFiles('notes').items[0]!.id, attachment.id);
    assert.equal(await a.deleteMessages('notes', [attachment.id]), 1);
    assert.equal(existsSync(join(a.filesDir, attachment.id)), false);
    assert.equal(a.snapshot().stats.notes!.messages, 1);
  } finally {
    await a.stop(); await b.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('Ruang berundangan, Pengumuman, koneksi manual, dan peer offline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-rooms-'));
  const peers = ['Andi', 'Budi', 'Citra'].map((name, index) => new LumilanPeer({
    dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
  }));
  const a = peers[0]!, b = peers[1]!, c = peers[2]!;
  try {
    for (const [index, peer] of peers.entries()) { await peer.start(); peer.rename(['Andi', 'Budi', 'Citra'][index]); }
    await a.connectAddress(b.addresses[0]);
    await a.connectAddress(c.addresses[0]);
    await b.connectAddress(c.addresses[0]);
    assert.equal(a.online.has(b.id) && b.online.has(c.id), true);
    await assert.rejects(a.connectAddress(`/ip4/8.8.8.8/tcp/40754/p2p/${b.id}`), /Kode perangkat tidak valid/);

    const { id } = await a.createRoom('Proyek', [b.id, c.id]);
    assert.equal(b.room(id)!.pending, true);
    assert.equal(c.room(id)!.pending, true);
    await b.acceptRoom(id);
    assert.equal((await a.sendRoomMessage('Hanya Budi', id)).delivered, 1);
    assert.equal(c.state.messages.some(message => message.roomId === id), false);
    await c.acceptRoom(id);
    await until(() => b.room(id)!.members.includes(c.id));
    await b.sendTyping(`room:${id}`, true);
    assert.deepEqual(a.snapshot().typing, [{ from: b.id, thread: `room:${id}` }]);
    await b.sendTyping(`room:${id}`, false);
    assert.deepEqual(a.snapshot().typing, []);
    a.archiveThread(`room:${id}`);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${id}`), true);
    await assert.rejects(a.sendRoomMessage('Tidak boleh dikirim', id), /Pulihkan percakapan/);
    assert.equal((await b.sendRoomMessage('Semua anggota', id)).delivered, 2);
    assert.equal(c.listMessages(`room:${id}`).at(-1)!.text, 'Semua anggota');
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${id}`), true);
    a.restoreThread(`room:${id}`);

    await a.updateRoom(id, [c.id]);
    assert.equal(b.room(id), undefined);
    await assert.rejects(b.sendTo(a.id, { type: 'typing', roomId: id, active: true }), /Status mengetik tidak valid/);
    await assert.rejects(b.sendRoomMessage('Ditolak', id), /Pesan Ruang tidak valid/);
    await assert.rejects(b.sendTo(c.id, { type: 'room-message', message: {
      id: randomUUID(), roomId: id, to: null, kind: 'text', text: 'Ditolak',
    } }), /Pesan Ruang ditolak/);

    assert.equal(a.snapshot().announcementRoomCreated, false);
    await assert.rejects(a.sendAnnouncement('Rapat pagi'), /Buat Ruang Pengumuman/);
    a.createAnnouncementRoom();
    assert.equal(a.snapshot().announcementRoomCreated, true);
    assert.throws(() => a.createAnnouncementRoom(), /sudah dibuat/);
    a.archiveThread('announcements');
    await assert.rejects(a.sendAnnouncement('Tidak boleh dikirim'), /Pulihkan percakapan/);
    a.restoreThread('announcements');
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
    await until(() => !a.room(declined.id)!.invited.includes(b.id));
    assert.equal(b.room(declined.id), undefined);
    const canceled = await a.createRoom('Dibatalkan', [b.id]);
    await a.updateRoom(canceled.id, []);
    assert.equal(b.room(canceled.id), undefined);
    a.archiveThread(`room:${canceled.id}`);
    assert.equal(await a.deleteArchivedHistory(`room:${canceled.id}`), 0);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${canceled.id}`), true);
    await a.deleteRoom(canceled.id);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${canceled.id}`), false);

    await c.stop();
    await until(() => !a.online.has(c.id));
    await assert.rejects(a.sendRoomMessage('Tidak diantrekan', id), /Tidak ada anggota Ruang yang online/);
    assert.equal(a.state.messages.some(message => message.text === 'Tidak diantrekan'), false);
    await a.deleteRoom(id);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${id}`), true);
    assert.equal(a.listMessages(`room:${id}`).length > 0, true);
    assert.throws(() => a.restoreThread(`room:${id}`), /Ruang sudah dihapus/);
    await a.deleteArchivedHistory(`room:${id}`);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === `room:${id}`), false);
    await c.start();
    await until(() => c.room(id) === undefined);
    assert.equal(c.snapshot().archivedThreads.some(item => item.id === `room:${id}`), true);
    const later = await a.createRoom('Keluar', [b.id]);
    await b.acceptRoom(later.id);
    await a.stop();
    await b.leaveRoom(later.id);
    assert.equal(b.room(later.id), undefined);
    await a.start();
    assert.equal(a.snapshot().announcementRoomCreated, true);
    a.deleteAnnouncementRoom();
    assert.equal(a.snapshot().announcementRoomCreated, false);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === 'announcements'), true);
    await assert.rejects(a.sendAnnouncement('Setelah dihapus'), /Buat Ruang Pengumuman/);
    a.createAnnouncementRoom();
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === 'announcements'), false);
    await until(() => !a.room(later.id)!.members.includes(b.id));
    a.archiveThread('announcements');
    assert.equal(await a.deleteArchivedHistory('announcements') > 0, true);
    assert.equal(a.snapshot().announcementRoomCreated, false);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === 'announcements'), false);
    a.createAnnouncementRoom();
    a.archiveThread('announcements');
    assert.equal(await a.deleteArchivedHistory('announcements'), 0);
    assert.equal(a.snapshot().announcementRoomCreated, false);
    await a.stop();
    await a.start();
    assert.equal(a.snapshot().announcementRoomCreated, false);
    assert.equal(a.snapshot().archivedThreads.some(item => item.id === 'announcements'), false);
  } finally {
    for (const peer of peers) await peer.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('mention Ruang ditargetkan dan mute percakapan tidak menghapus pesan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumilan-mention-'));
  const peers = ['Andi', 'Budi', 'Citra'].map((name, index) => new LumilanPeer({
    dataDir: join(root, String(index)), discovery: false, listen: '/ip4/127.0.0.1/tcp/0',
  }));
  const a = peers[0]!, b = peers[1]!, c = peers[2]!;
  try {
    for (const [index, peer] of peers.entries()) { await peer.start(); peer.rename(['Andi', 'Budi', 'Citra'][index]); }
    await a.connectAddress(b.addresses[0]);
    await a.connectAddress(c.addresses[0]);
    const { id } = await a.createRoom('Proyek', [b.id, c.id]);
    await b.acceptRoom(id);
    await c.acceptRoom(id);
    await until(() => a.room(id)!.members.length === 3 && b.room(id)!.members.length === 3 && c.room(id)!.members.length === 3);

    const text = 'Tolong cek @Budi';
    const mention = { id: b.id, start: text.indexOf('@Budi'), end: text.length };
    const receivedB: Message[] = [];
    b.on('incoming', message => receivedB.push(message));
    const sent = await a.sendRoomMessage(text, id, null, [mention]);
    assert.equal(sent.delivered, 2);
    assert.deepEqual(receivedB.at(-1)!.mentions, [mention]);
    assert.equal(c.listMessages(`room:${id}`).at(-1)!.mentions!.some(item => item.id === c.id), false);
    await assert.rejects(a.sendRoomMessage(text, id, null, [{ ...mention, id: a.id }]), /Mention Ruang tidak valid/);
    await assert.rejects(a.sendRoomMessage(text, id, null, [{ ...mention, end: 999 }]), /Mention Ruang tidak valid/);
    await assert.rejects(a.sendTo(b.id, { type: 'room-message', message: { ...sent.message, id: randomUUID(), mentions: [{ ...mention, id: a.id }] } }), /Mention Ruang tidak valid/);

    b.setThreadMuted(a.id, true);
    b.setThreadMuted(`room:${id}`, true);
    assert.deepEqual(b.snapshot().mutedThreads, [a.id, `room:${id}`]);
    const unreadBefore = b.snapshot().unread[`room:${id}`]!;
    await a.sendRoomMessage('Pesan biasa', id);
    await a.sendMessage('Pesan pribadi', b.id);
    assert.equal(b.snapshot().unread[`room:${id}`], unreadBefore + 1);
    assert.equal(b.snapshot().unread[a.id], 1);
    assert.equal(b.listMessages(`room:${id}`).at(-1)!.mentions, undefined);
    assert.throws(() => b.setThreadMuted('announcements', true), /Percakapan tidak tersedia/);
    await b.stop();
    await b.start();
    assert.deepEqual(b.snapshot().mutedThreads, [a.id, `room:${id}`]);
    b.setThreadMuted(`room:${id}`, false);
    assert.deepEqual(b.snapshot().mutedThreads, [a.id]);
  } finally {
    for (const peer of peers) await peer.stop();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});


test('persisted JSON is narrowed without losing legacy history or admitting malformed objects', () => {
  const peer = new LumilanPeer({dataDir: join(tmpdir(), 'unused-type-state-profile'), discovery: false});
  // The initial release stored only these four state fields and file messages had no digest.
  const firstRelease = {
    name: 'Legacy', trusted: [{id: 'legacy-contact', name: 'Contact', addresses: ['/ip4/192.168.1.2/tcp/40754']}],
    messages: [
      {id: randomUUID(), from: 'legacy-contact', fromName: 'Contact', to: null, text: 'Retained broadcast', kind: 'text', at: 1},
      {id: randomUUID(), from: 'self', fromName: 'Legacy', to: 'legacy-contact', name: 'old.bin', size: 4, kind: 'file', at: 2},
    ], unread: {'legacy-contact': 1},
  };
  const oldestRestored = readPeerState(JSON.parse(JSON.stringify(firstRelease)), peer.state);
  assert.deepEqual(oldestRestored.messages, firstRelease.messages);
  assert.deepEqual(oldestRestored.trusted, firstRelease.trusted);
  assert.deepEqual(oldestRestored.unread, firstRelease.unread);
  assert.deepEqual(oldestRestored.rooms, []);
  assert.deepEqual(oldestRestored.reminders, []);
  assert.equal(oldestRestored.status, 'active');
  const legacy = structuredClone(peer.state);
  legacy.messages.push({id: randomUUID(), from: 'self', to: null, text: 'Retained', kind: 'note', at: 1});
  const json = record(JSON.parse(JSON.stringify(legacy)));
  delete json.archivedThreads; delete json.pendingFileDeletes;
  const restored = readPeerState(json, peer.state);
  assert.deepEqual(restored.messages, legacy.messages);
  assert.deepEqual(restored.archivedThreads, {});
  assert.deepEqual(restored.pendingFileDeletes, []);
  assert.throws(() => readPeerState({...json, messages: [{kind: 'file', name: 4}]}, peer.state), /tidak valid/);
  assert.throws(() => readPeerState({...json, trusted: [{id: 'id', name: 'name', addresses: [4]}]}, peer.state), /tidak valid/);
});
